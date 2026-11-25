"""Contract 6.4: what the console does to an account, and what it has to say about it.

The site already stores the whole enforcement picture on the user row, a
`suspended_until`, a `suspend_reason`, a login lockout, and the main app's own
authentication refuses a suspended account on every request. So this module adds
the four things a paid console needs and the site does not have:

* a permanent suspension, which is the same column set to a date no clock
  reaches, instead of a second flag nobody would keep in sync;
* the email that goes with a suspension, carrying the reason and the Client's
  contact details, because a locked door with no note on it is only a bug;
* the money guards around a deletion, so an account is destroyed only once
  nothing is owed on it and nothing is running;
* a spam flag that is the pile the queue already counted, not a new counter.

Nothing here edits the main apps. The account moves on its own columns, the
wallet and the campaigns are read through their own models, and every action
writes to the same audit log the rest of the console reads.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, F, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.accounts import safety
from apps.accounts.models import RefreshSession, User
from apps.comments.models import Comment
from apps.common.api import person
from apps.common.emails import queue_event_email
from apps.marketplace.models import Listing
from apps.moderation.models import AuditLog, Report
from apps.notifications.services import notify
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.wallet.models import CoinRequest, DeletedWalletRecord, Transaction, Wallet, purging_ledger

from . import rbac, review, settings_store, spam
from .journal import record
from .models import CoinReview, PromoReview, PublicNotice, StaffAccount

OPEN_STATES = (Report.Status.OPEN, Report.Status.REVIEWING)
PROVIDERS = {'email': 'Email', 'google': 'Google', 'facebook': 'Facebook', 'apple': 'Apple'}

# A permanent suspension is the same column as a temporary one, set to a date no
# clock will reach: `is_suspended` keeps meaning "not allowed in" for both, and
# lifting either one is the same write. That is what makes a suspension
# impossible to half-lift, and why the console needs no second boolean.
PERMANENT_UNTIL = datetime(9999, 12, 31, 23, 59, 59, tzinfo=UTC)

CONTENT_MODELS = {'post': Post, 'comment': Comment, 'listing': Listing}
LIVE_STATES = {'post': Post.Status.LIVE, 'comment': Comment.Status.LIVE,
               'listing': Listing.Status.ACTIVE}
OWNER_FIELD = {'post': 'author', 'comment': 'author', 'listing': 'seller'}


class Refused(ValueError):
    """An action the console will not take, in the sentence to show instead."""


def threshold():
    """How many distinct reporters pull a post out of the feed on their own.

    Contract 6.9 makes this a knob on the spam desk rather than a deploy, so the
    desk's answer is what every screen in the console counts with, the server's
    own starting value still stands until somebody turns it.
    """
    return spam.report_threshold()


# ---------------------------------------------------------------- the read side


def directory(query='', state='', provider=''):
    """The member accounts the people screen works on, newest joiner first."""
    rows = (
        User.objects.select_related('profile', 'staff_account', 'wallet')
        .exclude(
            Q(is_staff=True) | Q(is_superuser=True) | Q(staff_account__is_enabled=True)
        )
        .annotate(
            # `created_at` is an alias for `date_joined`: the shared cursor pager
            # walks that column name, and a roster has to page like every screen.
            created_at=F('date_joined'),
            posts_count=Count('posts', filter=Q(posts__status=Post.Status.LIVE), distinct=True),
            followers_count=Count('followers', filter=Q(followers__status='accepted'), distinct=True),
        )
    )
    query = (query or '').strip()
    if query:
        rows = rows.filter(
            Q(username__icontains=query) | Q(email__icontains=query)
            | Q(first_name__icontains=query) | Q(last_name__icontains=query)
            | Q(profile__display_name__icontains=query)
        )
    now = timezone.now()
    state = (state or 'all').strip()
    if state == 'suspended':
        rows = rows.filter(suspended_until__gt=now)
    elif state == 'locked':
        rows = rows.filter(locked_until__gt=now)
    elif state == 'flagged':
        rows = rows.filter(pk__in=flagged_ids())
    elif state == 'verified':
        rows = rows.filter(profile__verified=True)
    elif state == 'unverified':
        rows = rows.filter(profile__verified=False)
    elif state == 'inactive':
        rows = rows.filter(is_active=False)
    elif state != 'all':
        raise Refused('Choose active, suspended, flagged, locked, verified or all.')
    # The state and the provider are two filters on one list, so a seat looking
    # for the Google sign-ups that are being reported can actually ask for them.
    provider = (provider or '').strip()
    if provider and provider != 'all':
        if provider not in PROVIDERS:
            raise Refused('Choose Email, Google, Facebook or Apple.')
        rows = rows.filter(provider=provider)
    return rows


def _piled_targets():
    """(kind, target_id) pairs sitting under at least `threshold` distinct reporters."""
    piled = (
        Report.objects.filter(status__in=OPEN_STATES, target_type__in=list(CONTENT_MODELS))
        .values('target_type', 'target_id')
        .annotate(reporters=Count('reporter', distinct=True))
        .filter(reporters__gte=threshold())
    )
    return [(item['target_type'], item['target_id']) for item in piled]


def flagged_ids():
    """Accounts a pile is sitting on right now, theirs or their content's."""
    ids = set()
    for item in (Report.objects.filter(target_type='user', status__in=OPEN_STATES)
                 .values('target_id')
                 .annotate(reporters=Count('reporter', distinct=True))
                 .filter(reporters__gte=threshold())):
        if str(item['target_id']).isdigit():
            ids.add(int(item['target_id']))
    for kind, target in _piled_targets():
        if not str(target).isdigit():
            continue
        field = OWNER_FIELD[kind]
        owner = (CONTENT_MODELS[kind].objects.filter(pk=int(target))
                 .values_list(f'{field}_id', flat=True).first())
        if owner is not None:
            ids.add(owner)
    return ids


def _pile_for(user_ids):
    """Open reports and distinct reporters per account, on it, and on what it owns.

    Three grouped queries for a whole page, because a directory row that counts
    its own pile with one query per report is a screen that stops answering at
    the moment it matters most.
    """
    out = {pk: {'account': 0, 'content': 0, 'reporters': set()} for pk in user_ids}
    if not user_ids:
        return out
    by_target = {str(pk): pk for pk in user_ids}
    for item in (Report.objects.filter(target_type='user', target_id__in=list(by_target),
                                       status__in=OPEN_STATES)
                 .values('target_id', 'reporter')):
        own = out[by_target[item['target_id']]]
        own['account'] += 1
        own['reporters'].add(item['reporter'])

    owner_of = {}
    for kind, model in CONTENT_MODELS.items():
        field = OWNER_FIELD[kind]
        for pk, owner in model.objects.filter(**{f'{field}_id__in': user_ids}) \
                .values_list('pk', f'{field}_id'):
            owner_of.setdefault(kind, {})[str(pk)] = owner
    for kind, by_id in owner_of.items():
        for item in (Report.objects.filter(target_type=kind, target_id__in=list(by_id),
                                           status__in=OPEN_STATES)
                     .values('target_id', 'reporter')):
            own = out[by_id[item['target_id']]]
            own['content'] += 1
            own['reporters'].add(item['reporter'])
    return {pk: {'account': item['account'], 'content': item['content'],
                 'reporters': len(item['reporters'])} for pk, item in out.items()}


def suspension_of(user):
    """What the account's own columns say about being barred, in one shape."""
    if not user.suspended_until or user.suspended_until <= timezone.now():
        return None
    end = user.suspended_until
    permanent = end >= PERMANENT_UNTIL
    return {
        'until': end,
        'permanent': permanent,
        'reason': user.suspend_reason,
        'days_left': None if permanent
                     else round(max(0.1, (end - timezone.now()).total_seconds() / 86400), 1),
    }


def seat_of(user):
    seat = getattr(user, 'staff_account', None)
    if seat is None:
        return None
    return {
        'role': seat.effective_role,
        'is_enabled': seat.is_enabled,
        'enrolled': seat.is_enrolled,
        'permissions': rbac.permissions_for(seat),
    }


def _seat_role(user):
    seat = getattr(user, 'staff_account', None)
    if seat is not None:
        return seat.effective_role
    return 'superadmin' if user.is_superuser else 'admin' if user.is_staff else 'user'


def _balance_of(user):
    wallet = getattr(user, 'wallet', None)
    if wallet is None:
        return Decimal('0')
    return wallet.balance


def _counts(user):
    """Live posts and accepted followers, annotated when paging, read when not."""
    posts = getattr(user, 'posts_count', None)
    if posts is None:
        posts = Post.objects.filter(author=user, status=Post.Status.LIVE).count()
    followers = getattr(user, 'followers_count', None)
    if followers is None:
        followers = user.followers.filter(status='accepted').count()
    return posts, followers


def row(user, pile=None, balance=None):
    """One account as the console reads it: who, how they joined, what is owed."""
    profile = getattr(user, 'profile', None)
    flags = pile or {'account': 0, 'content': 0, 'reporters': 0}
    posts, followers = _counts(user)
    balance = _balance_of(user) if balance is None else balance
    return {
        'id': user.pk,
        'username': user.username,
        'name': (profile.display_name if profile else '') or user.get_full_name() or user.username,
        'email': user.email,
        'bio': profile.bio if profile else '',
        'avatar_url': profile.avatar_url if profile else '',
        'verified': bool(profile.verified) if profile else False,
        'is_private': bool(profile.is_private) if profile else False,
        'notify_email': bool(profile.notify_email) if profile else True,
        'provider': user.provider,
        'provider_label': PROVIDERS.get(user.provider, user.provider or 'Unknown'),
        'email_verified': user.email_verified,
        'role': _seat_role(user),
        'seat': seat_of(user),
        'country': user.country,
        'city': user.city,
        'joined': user.date_joined,
        'coins': str(balance),
        'posts': posts,
        'followers': followers,
        'is_active': user.is_active,
        'suspension': suspension_of(user),
        'locked_until': user.locked_until,
        'failed_attempts': user.failed_attempts,
        'flags': {
            'on_account': flags['account'],
            'on_content': flags['content'],
            'reporters': flags['reporters'],
            'auto_hide_at': threshold(),
        },
    }


def rows(users):
    """A page of rows, with balances and piles counted in bulk."""
    ids = [user.pk for user in users]
    piles = _pile_for(ids)
    return [row(user, piles.get(user.pk)) for user in users]


def facets(users=None):
    """The numbers the filter chips are drawn from."""
    base = User.objects.all()
    now = timezone.now()
    return {
        'total': base.count(),
        'shown': users.count() if users is not None else None,
        'suspended': base.filter(suspended_until__gt=now).count(),
        'permanent': base.filter(suspended_until__gte=PERMANENT_UNTIL).count(),
        'locked': base.filter(locked_until__gt=now).count(),
        'verified': base.filter(profile__verified=True).count(),
        'deactivated': base.filter(is_active=False).count(),
        'flagged': len(flagged_ids()),
        'by_provider': {key: base.filter(provider=key).count() for key in PROVIDERS},
        'auto_hide_at': threshold(),
    }


def holdings(user):
    """What is still running on an account, which is what a deletion has to clear."""
    wallet = Wallet.objects.filter(user=user).first()
    return {
        'campaigns': Promotion.objects.filter(
            owner=user, status__in=(Promotion.Status.ACTIVE, Promotion.Status.PAUSED)).count(),
        'pending_requests': CoinRequest.objects.filter(
            user=user, status=CoinRequest.Status.PENDING).count(),
        'balance': str((wallet.balance if wallet else Decimal('0'))),
        'posts': Post.objects.filter(author=user).count(),
        'comments': Comment.objects.filter(author=user).count(),
        'listings': Listing.objects.filter(seller=user).count(),
    }


def ledger_rows(user):
    """The account's own ledger, for the detail card. Read-only: it is append-only."""
    wallet = Wallet.objects.filter(user=user).first()
    if wallet is None:
        return []
    return [{
        'id': move.pk, 'kind': move.kind, 'amount': str(move.amount), 'note': move.note,
        'staff': move.actor.username if move.actor_id else None, 'ref': move.ref,
        'created_at': move.created_at,
    } for move in Transaction.objects.filter(wallet=wallet).order_by('-created_at')[:10]]


def detail(user):
    """One account opened: the pile on it and its content, the warnings sent, the record."""
    recent = (
        Report.objects.filter(target_type='user', target_id=str(user.pk)).select_related('reporter')
        .order_by('-created_at')[:10]
    )
    content = []
    for kind, model in CONTENT_MODELS.items():
        field = OWNER_FIELD[kind]
        for pk, state in model.objects.filter(**{f'{field}': user}).values_list('pk', 'status'):
            pile = Report.objects.filter(target_type=kind, target_id=str(pk), status__in=OPEN_STATES)
            opened = pile.count()
            if state != LIVE_STATES[kind] or opened:
                content.append({
                    'target': f'{kind}:{pk}', 'state': state, 'open': opened,
                    'reporters': pile.values('reporter').distinct().count(),
                })
    warnings = user.notifications.filter(kind='warning').select_related('actor') \
        .order_by('-created_at')[:10]
    notices = PublicNotice.objects.filter(about=user).select_related('actor')
    return {
        'person': row(user, _pile_for([user.pk]).get(user.pk)),
        'holdings': holdings(user),
        'ledger': ledger_rows(user),
        # Everything the account has ever put on the platform, newest first. A seat
        # deciding a bar has to be able to read the sentences, not just count them.
        'posts': [{
            'id': str(item.pk), 'text': item.text[:280], 'state': item.status,
            'audience': item.audience, 'created_at': item.created_at,
            'likes': item.like_count, 'comments': item.comment_count,
            'preview': review.preview('post', item, full=True),
        } for item in Post.objects.filter(author=user).select_related('author__profile')
               .prefetch_related('media').order_by('-created_at')[:25]],
        'comments': [{
            'id': str(item.pk), 'text': item.text[:280], 'state': item.status,
            'created_at': item.created_at, 'post': str(item.post_id),
            'preview': review.preview('comment', item, full=True),
        } for item in Comment.objects.filter(author=user).select_related('author__profile', 'post__author')
               .order_by('-created_at')[:25]],
        'listings': [{
            'id': str(item.pk), 'title': item.title, 'price': str(item.price),
            'currency': item.currency, 'state': item.status, 'created_at': item.created_at,
            'preview': review.preview('listing', item, full=True),
        } for item in Listing.objects.filter(seller=user).select_related('seller__profile')
               .prefetch_related('images').order_by('-created_at')[:25]],
        'reports': [{
            'id': report.pk, 'reason': report.reason, 'details': report.details,
            'status': report.status, 'created_at': report.created_at,
            'reporter': person(report.reporter),
        } for report in recent],
        'content': sorted(content, key=lambda item: item['open'], reverse=True)[:20],
        'warnings': [{
            'text': item.text, 'actor': item.actor.username if item.actor else None,
            'created_at': item.created_at,
        } for item in warnings],
        'notices': [{
            'id': item.pk, 'target': f'{item.target_type}:{item.target_id}', 'text': item.text,
            'reason': item.reason, 'is_live': item.is_live, 'created_at': item.created_at,
            'actor': item.actor.username if item.actor else None, 'audience': item.audience,
            'withdrawn_at': item.withdrawn_at,
        } for item in notices.order_by('-created_at')[:10]],
        'audit': [{
            'id': log.pk, 'action': log.action, 'actor': log.actor.username if log.actor else None,
            'detail': log.detail, 'created_at': log.created_at,
        } for log in AuditLog.objects.filter(target=user.username).order_by('-created_at')[:20]],
    }


# ------------------------------------------------------------- the shared parts


def _end_of_day(day):
    return datetime.combine(day, datetime.max.time(), tzinfo=UTC)


def ends_at(days=None, until=None, permanent=False, now=None):
    """The one place a suspension's end is worked out, whichever way the seat typed it."""
    now = now or timezone.now()
    if permanent:
        return PERMANENT_UNTIL
    raw = str(until or '').strip()
    if raw:
        # A date with no clock on it means the whole day to the person who typed it
        # into "suspend until", so the end lands on its last second. `parse_datetime`
        # happily reads a bare date as midnight, which would lift a suspension a day
        # early, so the day-only shape is split off before it sees one.
        if ':' not in raw and len(raw) <= 10:
            moment = _end_of_day(parse_date(raw))
        else:
            moment = parse_datetime(raw)
            if moment is not None and timezone.is_naive(moment):
                moment = timezone.make_aware(moment, UTC)
        if moment is None:
            raise Refused('That is not a date. Pick one, or give a number of days.')
        if moment <= now:
            raise Refused('The end of a suspension has to be in the future.')
        return moment
    try:
        count = int(str(days).strip())
    except (TypeError, ValueError):
        raise Refused('Give a number of days, an end date, or make it permanent.') from None
    if not 1 <= count <= 3650:
        raise Refused('A temporary suspension is between 1 day and 10 years. '
                      'Past that, suspend for good or delete the account.')
    return now + timedelta(days=count)


def locked_out(user, now=None):
    """Every refresh token they hold, dead at once.

    The short access cookie cannot be pulled out of a browser, but the main app's
    authentication already refuses a suspended account on every request, so the
    session they are holding stops at their next click and cannot be renewed.
    That is the whole of "logs the user out immediately", and the screen says
    exactly that rather than more.
    """
    now = now or timezone.now()
    return RefreshSession.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=now)


def enforcement_email(user, subject, body, *,
                      footnote='If you believe this action was taken in error, contact the Exposing team using the details below.'):
    """The branded email a barred or warned account gets, with the Client's contact foot."""
    if not user.email:
        return None
    queue_event_email(user.email, subject, subject, body, footnote=footnote)
    return {'to': user.email, 'subject': subject}


def client_accounts():
    """Every account that is the Client: a superuser, or a seat whose role says so.

    Both count, because the roster row is created lazily, a superuser with no
    `StaffAccount` yet is still the person who can undo every other decision, so
    a guard that only looked at the seat table would happily lock the last one
    out from an account the console signs in with.
    """
    ids = set(StaffAccount.objects.filter(role=StaffAccount.Role.SUPERADMIN)
              .values_list('user_id', flat=True))
    ids.update(User.objects.filter(is_superuser=True).values_list('pk', flat=True))
    return ids


def other_clients(user):
    """How many Client accounts there are besides this one."""
    left = 0
    for pk in client_accounts():
        if pk == user.pk:
            continue
        seat = StaffAccount.objects.filter(user_id=pk).first()
        if seat is None or seat.is_enabled:
            left += 1
    return left


def is_client(user):
    return user.pk in client_accounts()


def guard_target(user, caller):
    """The two accounts nobody may be locked out of from the console."""
    if user.pk == caller.pk:
        raise Refused('You cannot act on the account you are signed in with.')
    if is_client(user) and not other_clients(user):
        raise Refused('The last Client seat cannot be suspended or deleted.')


def locked(user):
    """Read the account again, with its row locked until this action is committed.

    The console hands every screen the same plain read, so two seats holding the
    same page open each decide against the copy of the account they were given.
    A moderator's Reinstate that starts a moment before your Suspend commits used
    to write the row back to clear and lift the bans your suspend had just
    raised, and the account was simply back in the feed. Inside the lock the
    second seat reads the first one's answer and refuses, which is what the coin
    and promotion desks already do.
    """
    try:
        return User.objects.select_for_update().get(pk=user.pk)
    except User.DoesNotExist:
        raise Refused('That account has already been deleted, nothing here acts on it again.')


# --------------------------------------------------------------- the six actions


def suspend(user, caller, *, reason, days=None, until=None, permanent=False):
    reason = str(reason or '').strip()
    if not reason:
        raise Refused('Say why the account is suspended. This sentence is emailed to them.')
    now = timezone.now()
    end = ends_at(days=days, until=until, permanent=permanent, now=now)
    with transaction.atomic():
        account = locked(user)
        guard_target(account, caller)
        # One verdict at a time. Without this the second seat silently re-dated the
        # first one's bar and wrote a second email about the same account.
        if account.suspended_until and account.suspended_until > now:
            raise Refused(f'They are already suspended until {account.suspended_until:%d %b %Y}. '
                          'Reinstate the account first, then suspend it again.')
        account.suspended_until = end
        account.suspend_reason = reason[:200]
        account.save(update_fields=['suspended_until', 'suspend_reason'])
        kicked = locked_out(account, now)
        # Suspension ends the seat they are sitting in. The address and every browser
        # that account was trusted on are closed for as long as the suspension runs.
        # The public IP is deliberately not included: other people may share it.
        closed = safety.raise_bans(
            account.email, end, 'admin',
            devices=[account.last_device,
                     *list(account.trusted_devices.values_list('device_id', flat=True))],
        )
        notify(account, caller, 'warning',
               f'Your account is suspended {"for good" if permanent else f"until {end:%Y-%m-%d}"}: {reason}',
               'user', account.pk)
        emailed = enforcement_email(
            account, 'Your Exposing account is suspended',
            f'Your account @{account.username} is suspended '
            f'{"for good, until staff put it back" if permanent else f"until {end:%Y-%m-%d %H:%M} UTC"}.\n\n'
            f'Reason: {reason}\n\n'
            'While it is suspended you cannot sign in, and a session that is already '
            'open stops working at your next request.',
        )
        record(caller, 'suspend_user', account.username,
               f'{"permanent" if permanent else f"until {end:%Y-%m-%d %H:%M}"}: {reason}')
        user.refresh_from_db()
    return {
        'action': 'suspend', 'username': account.username, 'permanent': permanent,
        'suspension': suspension_of(account), 'emailed': emailed, 'sessions_revoked': kicked,
        'detail': (f'Suspended {"for good" if permanent else f"until {end:%d %b %Y}"}. '
                   f'{kicked} open session(s) cannot be renewed. '
                   + ('Sign-in, sign-up and Google are blocked for this account and its trusted browsers. '
                      if closed else '')
                   + (f'An email went to {emailed["to"]}.' if emailed
                      else 'There is no email address on this account.')),
        'banned': closed,
    }


def reinstate(user, caller):
    with transaction.atomic():
        account = locked(user)
        if not account.suspended_until or account.suspended_until <= timezone.now():
            raise Refused('That account is not suspended.')
        guard_target(account, caller)
        account.suspended_until = None
        account.suspend_reason = ''
        account.save(update_fields=['suspended_until', 'suspend_reason'])
        # The seat is back; so are the doors. Only the bans this suspension raised,
        # a cooloff someone else caused on the same connection stays where it is.
        lifted = safety.lift(account.email, reasons=['admin'])
        notify(account, caller, 'warning', 'Your account suspension was lifted by staff.',
               'user', account.pk)
        record(caller, 'reinstate_user', account.username, 'suspension lifted')
        emailed = enforcement_email(account, 'Your Exposing account is back',
                                    'Your account suspension was lifted by staff. '
                                    'You can sign in again right now.', footnote='')
        user.refresh_from_db()
    doors = f'The suspension is lifted and {lifted} sign-in ban(s) with it. ' if lifted else 'The suspension is lifted. '
    return {
        'action': 'reinstate', 'username': account.username, 'suspension': None, 'bans_lifted': lifted,
        'emailed': emailed,
        'detail': doors + 'They can sign in again right now.'
        + (f' An email went to {emailed["to"]}.' if emailed
           else ' There is no email address on this account.'),
    }


def verify(user, caller, *, verified, reason=''):
    """The blue tick, put on or taken off by a seat, with the reason kept."""
    verified = bool(verified)
    reason = str(reason or '').strip()
    with transaction.atomic():
        account = locked(user)
        profile = getattr(account, 'profile', None)
        if profile is None:
            raise Refused('That account has no profile to put a tick on.')
        if profile.verified == verified:
            raise Refused(f'The tick is already {"on" if verified else "off"} this profile.')
        if verified and not reason:
            raise Refused('Say what made this account worth a tick. It goes on the audit row.')
        profile.verified = verified
        profile.save(update_fields=['verified'])
        notify(account, caller, 'warning',
               f'Your profile is {"verified" if verified else "no longer verified"}.'
               + (f' {reason}' if reason else ''), 'user', account.pk)
        tick = (f'Your Exposing profile is {"verified" if verified else "no longer verified"}.'
                + (f' {reason}' if reason else ''))
        emailed = enforcement_email(account, tick.rstrip('.'), tick, footnote='')
        record(caller, 'verify_user' if verified else 'unverify_user', account.username,
               reason or ('tick added' if verified else 'tick removed'))
        out = {
            'action': 'verify', 'username': account.username, 'verified': verified,
            'person': row(account), 'emailed': emailed,
            'detail': (f'@{account.username} is verified, the tick is on their profile.' if verified
                       else f'The tick is off @{account.username}.')
            + (f' An email went to {emailed["to"]}.' if emailed
               else ' There is no email address on this account.'),
        }
    return out


def warn(user, caller, *, text, reason='', audience=PublicNotice.Audience.PRIVATE):
    """A warning on the profile and in the bell, with a mailbox copy unless opted out."""
    text = str(text or '').strip()
    if not text:
        raise Refused('Write the warning. These are the words they read.')
    if len(text) > 240:
        raise Refused('A warning is 240 characters or less.')
    reason = str(reason or '').strip()
    with transaction.atomic():
        account = locked(user)
        profile = getattr(account, 'profile', None)
        notice = review.attach('user', account.pk, caller, reason, text, audience)
        opted_out = profile is not None and not profile.notify_email
        emailed = None if opted_out else enforcement_email(
            account, 'A note from the Exposing team', text)
        record(caller, 'warn_user', account.username,
               (f'{text}, {reason}' if reason else text)[:240])
    return {
        'action': 'warn', 'username': account.username, 'emailed': emailed, 'opted_out': opted_out,
        'notice': notice,
        'detail': (f'@{account.username} was warned in the app.'
                   + (' They turned warning emails off, so nothing was sent to their inbox.' if opted_out
                      else (f' An email went to {emailed["to"]}.' if emailed
                            else ' There is no email address on this account.'))),
    }


@transaction.atomic
def clear_flags(user, caller, *, reason=''):
    """The pile is gone: reports closed, warnings withdrawn, lockout cleared.

    Content a moderator took down deliberately stays down, that is a decision,
    not a flag, and the answer says so, because an admin who expected the feed
    to fill back up has to know the difference.
    """
    reason = str(reason or '').strip()
    if not reason:
        raise Refused('Say why the flags are being cleared. The audit row keeps the reason.')
    # The account row is taken first and the notices under it second, in that order
    # everywhere, so two seats clearing the same pile queue instead of deadlock.
    account = locked(user)
    now = timezone.now()
    # One verdict at a time, read under the lock. Without this the second seat
    # finds an empty pile, still writes its letter and still fills the record.
    pile = _pile_for([account.pk]).get(account.pk) or {'account': 0, 'content': 0}
    lockout = bool(account.locked_until and account.locked_until > now) or bool(account.failed_attempts)
    if not (pile['account'] or pile['content']
            or PublicNotice.objects.filter(about=account, is_live=True).exists() or lockout):
        raise Refused('Nothing stands against this account: no open report, no live warning '
                      'and no login lockout. There is nothing to clear.')
    closed = Report.objects.filter(target_type='user', target_id=str(account.pk),
                                   status__in=OPEN_STATES) \
        .update(status=Report.Status.DISMISSED, resolved_at=now)
    for kind, model in CONTENT_MODELS.items():
        field = OWNER_FIELD[kind]
        pks = [str(pk) for pk in model.objects.filter(**{f'{field}': account})
               .values_list('pk', flat=True)]
        if pks:
            closed += Report.objects.filter(target_type=kind, target_id__in=pks,
                                            status__in=OPEN_STATES) \
                .update(status=Report.Status.DISMISSED, resolved_at=now)
    withdrawn = 0
    for notice in PublicNotice.objects.select_for_update().filter(about=account, is_live=True):
        review.withdraw(notice, caller)
        withdrawn += 1
    account.failed_attempts = 0
    account.locked_until = None
    account.save(update_fields=['failed_attempts', 'locked_until'])
    # Clearing the lockout means the whole way back in, not just the password box:
    # the cooloff also closed their connection and their browser.
    safety.lift(account.email, reasons=['lock'])
    held = Post.objects.filter(author=account, status=Post.Status.HIDDEN).count()
    notify(account, caller, 'warning',
           'The reports and warnings on your account were reviewed and cleared.'
           + (f' {held} post(s) are still held for a separate decision.' if held
              else ' Nothing else is held against you.'), 'user', account.pk)
    emailed = enforcement_email(account, 'An update on the reports against your account',
                                'The reports and warnings on your account were reviewed and cleared.'
                                + (f' {held} post(s) are still held for a separate decision.' if held
                                   else ' Nothing else is held against you.'), footnote='')
    record(caller, 'clear_spam_flags', account.username,
           f'{closed} report(s) dismissed, {withdrawn} notice(s) withdrawn, lockout cleared. {reason}'[:240])
    user.refresh_from_db()
    return {
        'action': 'clear_flags', 'username': account.username, 'reports_closed': closed,
        'notices_withdrawn': withdrawn, 'held_posts': held, 'emailed': emailed,
        'detail': (f'{closed} open report(s) closed, {withdrawn} warning notice(s) withdrawn '
                   'and the login lockout cleared. '
                   + (f'{held} post(s) of theirs are still out of the feed on an earlier '
                      'decision, release them from the Takedown shelf.' if held
                      else 'Nothing of theirs is held.'))
        + (f' An email went to {emailed["to"]}.' if emailed
           else ' There is no email address on this account.'),
    }


def money_record(account):
    """The account's whole money history, read before the deletion cascade takes it.

    Kept as plain values with staff names as text: a dispute months from now has
    to be answerable without the account row, the wallet, or any staff seat it
    names still existing. The delete guards mean the balance reads zero by the
    time this runs, so the figure is recorded anyway, as the number the ledger
    added up to on the day.
    """
    wallet = Wallet.objects.filter(user=account).first()
    movements = [] if wallet is None else [{
        'kind': move.kind, 'amount': str(move.amount), 'note': move.note,
        'ref': move.ref, 'staff': move.actor.username if move.actor_id else None,
        'created_at': move.created_at.isoformat(),
    } for move in Transaction.objects.filter(wallet=wallet).order_by('created_at', 'id')]
    requests = [{
        'coins': req.coins, 'amount': str(req.amount), 'method': req.method,
        'reference': req.reference, 'status': req.status,
        'created_at': req.created_at.isoformat(),
        'reviewed_at': req.reviewed_at.isoformat() if req.reviewed_at else None,
        'reviews': [{
            'action': item.action, 'reason': item.reason,
            'staff': item.actor.username if item.actor_id else None,
            'coins_credited': item.coins_credited,
            'created_at': item.created_at.isoformat(),
        } for item in CoinReview.objects.filter(request=req).order_by('created_at', 'id')],
    } for req in CoinRequest.objects.filter(user=account).order_by('created_at', 'id')]
    campaigns = [{
        'package': promo.package, 'budget': str(promo.budget), 'status': promo.status,
        'target': f'{promo.target_type}:{promo.target_id}',
        'starts_at': promo.starts_at.isoformat() if promo.starts_at else None,
        'ends_at': promo.ends_at.isoformat() if promo.ends_at else None,
        'created_at': promo.created_at.isoformat(),
        'reviews': [{
            'action': item.action, 'reason': item.reason,
            'staff': item.actor.username if item.actor_id else None,
            'coins_refunded': str(item.coins_refunded), 'choice': item.choice,
            'created_at': item.created_at.isoformat(),
        } for item in PromoReview.objects.filter(promotion=promo).order_by('created_at', 'id')],
    } for promo in Promotion.objects.filter(owner=account).order_by('created_at', 'id')]
    return {
        'username': account.username,
        'email': account.email,
        'provider': account.provider,
        'joined': account.date_joined.isoformat(),
        'balance_at_deletion': str(wallet.balance) if wallet else '0',
        'movements': movements,
        'requests': requests,
        'campaigns': campaigns,
    }


def delete(user, caller, *, confirm, reason=''):
    """An account destroyed, on the record, with the money settled first.

    The cascade is the point of the guards: posts, comments, listings, follows,
    messages and the wallet with its ledger go with the account and none of it
    comes back. So the balance has to be zero, no campaign may still be running
    and no payment proof may be waiting, each settled from the screen that owns
    it, which is what the refusal names. The money record is the one thing kept:
    every movement, deposit reference and approval decision is copied to the
    archive before the rows go, because a payment dispute outlives the account.
    """
    reason = str(reason or '').strip()
    confirm = str(confirm or '').strip().lower()
    if not reason:
        raise Refused('Say why the account is deleted. The reason is all that survives.')
    with transaction.atomic():
        account = locked(user)
        if confirm != account.username.lower():
            raise Refused(f'Type the username "{account.username}" to confirm this.')
        guard_target(account, caller)
        # Read under the lock: a campaign a second seat stopped a moment ago, or a
        # wallet a coin approval just refilled, would otherwise be missed and
        # destroyed with the account.
        held = holdings(account)
        if held['campaigns']:
            raise Refused(f'They are running {held["campaigns"]} campaign(s). '
                          'Stop them from Promotions first.')
        if held['pending_requests']:
            raise Refused(f'{held["pending_requests"]} payment proof(s) are waiting. '
                          'Decide them from Coin requests first.')
        if Decimal(held['balance']) != 0:
            raise Refused(f'The wallet still holds {held["balance"]} coins. Settle it from '
                          'Coins and payments first.')
        username = account.username
        # The money record leaves first: once the cascade runs there is no wallet
        # and no ledger to read, and the archive is the copy a dispute is settled
        # from. It holds no foreign keys, so the delete takes nothing from it.
        DeletedWalletRecord.objects.create(username=username, record=money_record(account))
        # The audit row outlives the account: its `actor` is nullable and its
        # `target` is text, so this sentence is all anyone can read afterwards about
        # what was destroyed here, which is why it is written before the delete.
        record(caller, 'delete_user', username,
               f'{held["posts"]} posts, {held["comments"]} comments, {held["listings"]} listings '
               f'and {held["balance"]} coins went with the account; the money record is kept. '
               f'{reason}'[:240])
        # The letter leaves before the row goes: the mailbox is the only place this
        # member can still be reached, and the address is a string the thread does
        # not need the account row for.
        emailed = enforcement_email(account, 'Your Exposing account was deleted',
                                    f'Your Exposing account @{username} was deleted by the Exposing team. '
                                    f'Reason: {reason}. Your posts, comments, listings and wallet went with '
                                    'it, and this cannot be undone.')
        # The cascade takes the wallet and its ledger rows with the account, and
        # the ledger trigger only lets a transaction that asked for a purge
        # remove them — this one did, after the archive copy above.
        with purging_ledger():
            account.delete()
    return {
        'action': 'delete', 'username': username, 'holdings': held, 'emailed': emailed,
        'detail': (f'@{username} is deleted, with their {held["posts"]} post(s), '
                   f'{held["comments"]} comment(s) and {held["listings"]} listing(s). '
                   'This cannot be undone; the audit row names who did it, and the '
                   'money record — every movement, deposit reference and approval '
                   'decision — is kept for disputes.')
        + (f' An email went to {emailed["to"]}.' if emailed
           else ' There is no email address on this account.'),
    }
