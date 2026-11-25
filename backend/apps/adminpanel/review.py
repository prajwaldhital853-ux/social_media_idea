"""Contract 6.3: what one decision does to a post, a listing, a campaign and a person.

The site can already hide a post that enough people reported and take content
down one report at a time from an endpoint gated on Django's `is_staff` flag. A
console a client pays for needs three more things, and they are all here:

* a reason that is recorded, shown to the author, and readable afterwards;
* one decision that clears the whole pile on a target instead of ten clicks;
* the money side, a campaign whose content moderation removed stops, and the
  days it never got to run are handed back through the ledger it came from.

Nothing in the main apps is edited to make that happen: the content rows move on
their own `status` column, the campaigns on their own `ends_at`, and every move
is written to the same audit log the rest of the console uses.
"""

from decimal import Decimal

from django.db import transaction
from django.db.models import Count, F, Q
from django.db.models.functions import Greatest
from django.utils import timezone

from apps.accounts.models import User
from apps.comments.models import Comment
from apps.common.api import person
from apps.marketplace.models import Listing
from apps.moderation.models import Report
from apps.notifications.services import notify
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.wallet.models import Transaction as CoinMove, Wallet, apply

from .journal import record
from .models import PublicNotice

OPEN_STATES = (Report.Status.OPEN, Report.Status.REVIEWING)
KINDS = ('post', 'comment', 'listing', 'user')
ACTIONS = ('dismiss', 'remove', 'warn', 'release', 'restore')

MODEL = {'post': Post, 'comment': Comment, 'listing': Listing, 'user': User}
# Each model calls its own "visible again" state something different.
LIVE_STATE = {'post': Post.Status.LIVE, 'comment': Comment.Status.LIVE, 'listing': Listing.Status.ACTIVE}
REMOVED_STATE = {'post': Post.Status.REMOVED, 'comment': Comment.Status.REMOVED, 'listing': Listing.Status.REMOVED}
HIDDEN_STATE = {'post': Post.Status.HIDDEN, 'comment': Comment.Status.HIDDEN}
AUDIT = {
    'dismiss': 'dismiss_reports',
    'remove': 'remove_content',
    'warn': 'public_notice',
    'release': 'release_content',
    'restore': 'restore_content',
}
# Which seat has to hold the pen. Reading the queue is one key; deciding a
# listing is marketplace work and deciding a post is content work, so a seat
# hired for one of them is not handed the other.
KEY_BY_KIND = {'post': 'content', 'comment': 'content', 'listing': 'listings', 'user': 'reports'}


def actions_for(kind, state):
    """Which of the five verbs this target is actually standing in.

    A row that offers "release" for a live post is a button that can only fail,
    so the current state decides the verbs, and `act()` still checks them again,
    because the screen the moderator is looking at may be a minute old.
    """
    if kind == 'user':
        return ['dismiss', 'warn']
    if state == HIDDEN_STATE.get(kind):
        return ['dismiss', 'remove', 'warn', 'release']
    if state == REMOVED_STATE[kind]:
        return ['restore', 'warn']
    return ['dismiss', 'remove', 'warn']


def pk_of(target_id):
    text = str(target_id or '').strip()
    return int(text) if text.isdigit() else None


def row_for(kind, target_id):
    """The post, comment, listing or account a report points at, if it still exists."""
    model = MODEL.get(kind)
    pk = pk_of(target_id)
    if model is None or pk is None:
        return None
    return model.objects.filter(pk=pk).first()


def owner_for(kind, row):
    if kind in ('post', 'comment'):
        return row.author
    if kind == 'listing':
        return row.seller
    return row


def state_of(kind, row):
    if kind == 'user':
        if row.suspended_until and row.suspended_until > timezone.now():
            return 'suspended'
        return 'active' if row.is_active else 'deactivated'
    return row.status


def match(text, terms):
    """Which blocked words appear in this content. `terms` is read once per page."""
    haystack = ' '.join(str(text or '').split()).lower()
    if not haystack:
        return []
    return sorted({term for term in terms if term and term in haystack})


def campaigns_on(kind, target_id):
    if kind not in ('post', 'listing'):
        return Promotion.objects.none()
    return Promotion.objects.filter(
        target_type=kind, target_id=str(target_id),
        status__in=(Promotion.Status.ACTIVE, Promotion.Status.PAUSED),
    ).select_related('owner')


def unspent(promo, now):
    """The coins a timed campaign paid for and never got the chance to spend.

    A campaign with no end date was bought as an open run, so nothing about
    stopping it early is unearned; it refunds nothing and says so. The run is
    measured from `starts_at`, the day the coins were actually taken, the order
    date can sit days before it while a seat reads the queue, and counting those
    days as spent would refund less than the payer ever bought.
    """
    budget = Decimal(promo.budget or 0)
    if budget <= 0 or promo.ends_at is None:
        return Decimal('0')
    began = promo.starts_at or promo.created_at
    span = (promo.ends_at - began).total_seconds()
    left = (promo.ends_at - now).total_seconds()
    if span <= 0 or left <= 0:
        return Decimal('0')
    return (budget * Decimal(str(left)) / Decimal(str(span))).quantize(Decimal('1'))


def cancel_campaigns(kind, target_id, now):
    """Stop what is running on this content, through the same ledger it paid from."""
    stopped = []
    total = Decimal('0')
    ids = list(campaigns_on(kind, target_id).values_list('pk', flat=True))
    with transaction.atomic():
        for promo in (Promotion.objects.select_for_update().select_related('owner')
                      .filter(pk__in=ids).order_by('pk')):
            if promo.status not in (Promotion.Status.ACTIVE, Promotion.Status.PAUSED):
                # A seat decided this campaign while the takedown was being written:
                # its money already moved through that decision, so nothing refunds twice.
                continue
            refund = unspent(promo, now)
            promo.status = Promotion.Status.ENDED
            promo.ends_at = now
            promo.save(update_fields=['status', 'ends_at'])
            if refund > 0:
                wallet, _ = Wallet.objects.get_or_create(user=promo.owner)
                apply(wallet.pk, CoinMove.Kind.CREDIT, refund,
                      f'Refund: campaign {promo.pk} stopped when moderation removed {kind}:{target_id}')
                total += refund
            stopped.append({
                'id': promo.pk, 'owner': promo.owner.username, 'package': promo.package,
                'budget': str(promo.budget), 'refunded': str(refund),
            })
    return stopped, total


def close_reports(kind, target_id, status, now):
    """Every open report on one target, closed by the same decision.

    A moderator who decides a post is fine should not have to click through the
    six people who reported it, and a post that stays down keeps attracting
    reports that re-hide it the moment someone releases it.
    """
    rows = Report.objects.filter(target_type=kind, target_id=str(target_id), status__in=OPEN_STATES)
    count = rows.update(status=status, resolved_at=now)
    return count


def pile(kind, target_id):
    """What the queue needs to know about a target before anyone opens it."""
    rows = Report.objects.filter(target_type=kind, target_id=str(target_id))
    stats = rows.aggregate(
        total=Count('pk'),
        open_n=Count('pk', filter=Q(status__in=OPEN_STATES)),
        reporters=Count('reporter', distinct=True, filter=Q(status__in=OPEN_STATES)),
    )
    reasons = rows.filter(status__in=OPEN_STATES).values('reason').annotate(n=Count('pk')).order_by('-n', 'reason')
    return {
        'reports': stats['total'],
        'open': stats['open_n'],
        'reporters': stats['reporters'],
        'reasons': [{'reason': row['reason'], 'n': row['n']} for row in reasons[:4]],
    }


def _media(post, limit=4):
    out = []
    items = post.media.all()
    if limit is not None:
        items = items[:limit]
    for item in items:
        url = item.url or (item.file.url if item.file else '')
        out.append({'kind': item.kind, 'url': url, 'duration': item.duration})
    return out


def preview(kind, row, full=False):
    """The thing itself, in the words a decision is made from."""
    if row is None:
        return None
    if kind == 'post':
        return {
            'kind': kind, 'id': row.pk, 'state': row.status,
            'text': row.text if full else row.text[:600],
            'author': person(row.author), 'created_at': row.created_at,
            'audience': row.audience, 'category': row.category,
            'media': _media(row, None if full else 4),
            'likes': row.like_count, 'comments': row.comment_count,
        }
    if kind == 'comment':
        return {
            'kind': kind, 'id': row.pk, 'state': row.status,
            'text': row.text if full else row.text[:600],
            'author': person(row.author), 'created_at': row.created_at,
            'on_post': {
                'id': row.post_id, 'text': row.post.text if full else (row.post.text or '')[:160],
                'author': row.post.author.username, 'state': row.post.status,
            },
        }
    if kind == 'listing':
        images = [item.url for item in row.images.all() if item.url]
        if row.image_url:
            images = [row.image_url] + [url for url in images if url != row.image_url]
        out = {
            'kind': kind, 'id': row.pk, 'state': row.status, 'title': row.title,
            'text': row.description if full else row.description[:600],
            'price': str(row.price), 'currency': row.currency,
            'category': row.category, 'condition': row.condition, 'location': row.location,
            'image': images[0] if images else '',
            'author': person(row.seller), 'created_at': row.created_at,
        }
        if full:
            out['images'] = images
        return out
    return {
        'kind': kind, 'id': row.pk, 'state': state_of(kind, row),
        'author': person(row), 'created_at': row.date_joined,
        'email': row.email, 'is_staff': row.is_staff, 'suspended_until': row.suspended_until,
    }


def audience_of(value):
    """Which readers a notice is written for, or a refusal to write it at all.

    Guessing `public` for a word the console did not send would put a sentence
    meant for one person in front of everybody, so an unknown answer is an error
    rather than a default.
    """
    text = str(value or '').strip().lower()
    if text in ('', PublicNotice.Audience.PUBLIC):
        return PublicNotice.Audience.PUBLIC
    if text == PublicNotice.Audience.PRIVATE:
        return PublicNotice.Audience.PRIVATE
    raise ValueError('Choose who reads this notice: public, or private.')


def _notice(kind, row, actor, reason, text, audience=PublicNotice.Audience.PUBLIC):
    notice = PublicNotice.objects.create(
        target_type=kind, target_id=str(row.pk), about=owner_for(kind, row),
        text=text[:240], reason=reason[:120], actor=actor,
        audience=audience_of(audience),
    )
    return notice


def attach(kind, target_id, actor, reason, text, audience=PublicNotice.Audience.PUBLIC, *, email=False):
    """Put a notice on one target with no report and no decision behind it.

    The queue writes a notice as half of a verdict; a false-information claim
    nobody reported needs the same sentence over the same content, so both paths
    end in this row rather than in two shapes of it. A private audience keeps the
    sentence on the same content and shows it to the one account it is about.

    `email` asks for the mailbox copy too, which the notices desk wants because a
    sentence standing on content is only read by someone who comes back to it.
    """
    row = row_for(kind, target_id)
    if row is None:
        raise ValueError(f'There is no {kind} {target_id} to put a notice on.')
    audience = audience_of(audience)
    notice = _notice(kind, row, actor, reason, text, audience)
    _say(kind, row, actor, text, notice=notice)
    out = notice_row(notice)
    if email:
        out['emailed'] = email_owner(kind, row, 'A note from the Exposing team', text, warning=True)
    return out


def notice_row(notice):
    return {
        'id': notice.pk,
        'target': f'{notice.target_type}:{notice.target_id}',
        'target_type': notice.target_type,
        'target_id': notice.target_id,
        'about': notice.about.username,
        'audience': notice.audience,
        'text': notice.text,
        'reason': notice.reason,
        'actor': notice.actor.username if notice.actor else None,
        'created_at': notice.created_at,
        'is_live': notice.is_live,
        'withdrawn_at': notice.withdrawn_at,
    }


def withdraw(notice, actor):
    if not notice.is_live:
        raise ValueError('That notice was already withdrawn.')
    notice.is_live = False
    notice.withdrawn_at = timezone.now()
    notice.save(update_fields=['is_live', 'withdrawn_at'])
    record(actor, 'withdraw_notice', f'{notice.target_type}:{notice.target_id}', notice.text[:120])
    return notice


def _say(kind, row, actor, text, notice=None):
    """The author-facing half of a moderation decision, in their bell."""
    return notify(owner_for(kind, row), actor, 'warning', text, kind, row.pk, notice=notice)


def email_owner(kind, row, subject, body, *, warning=False):
    """Send the content owner the same branded notice that account enforcement uses.

    `warning` marks a letter the member asked not to receive: a sentence over live
    content is optional, so their setting decides it. A takedown is not, they
    cannot sign in to find out why, so the mailbox is the only notice they get.
    """
    owner = owner_for(kind, row)
    if owner is None or not owner.email:
        return None
    profile = getattr(owner, 'profile', None)
    if warning and profile is not None and not profile.notify_email:
        return None
    # people imports this module for account warnings, so the return visit stays inside the call.
    from .people import enforcement_email

    return enforcement_email(owner, subject, body)


def suspension_notice(kind, row, actor, reason):
    posted = timezone.localtime(row.created_at).strftime('%d %b %Y at %H:%M') if kind != 'user' else ''
    when = f', posted {posted},' if posted else ','
    return f'Your {kind}{when} was suspended due to: {reason}'


def act(kind, target_id, actor, action, reason='', notice_text='', audience=PublicNotice.Audience.PUBLIC):
    """Apply one action to one target. Raises ValueError with the sentence to show.

    `decide()` is this with a report attached; the takedown shelf calls it
    directly, because restoring a post three weeks after the reports closed has
    no live report to hang the decision on.

    `audience` only ever applies to the notice this action may write: taking a
    post down is public whatever the seat chose, and a private notice is the
    option for the sentence that stays over content nobody else is being warned
    about.
    """
    if action not in ACTIONS:
        raise ValueError('Choose dismiss, remove, warn, release or restore.')
    row = row_for(kind, target_id)
    if row is None:
        raise ValueError(f'That {kind} is no longer here, so there is nothing to act on.')
    reason = str(reason or '').strip()
    notice_text = str(notice_text or '').strip()
    audience = audience_of(audience) if notice_text else PublicNotice.Audience.PUBLIC
    now = timezone.now()
    out = {
        'action': action, 'kind': kind, 'target': f'{kind}:{row.pk}',
        'content': preview(kind, row), 'reports_closed': 0,
        'campaigns': [], 'refunded': '0', 'notice': None, 'audience': audience, 'detail': '',
    }
    owner_mail = None

    if action == 'dismiss':
        out['reports_closed'] = close_reports(kind, row.pk, Report.Status.DISMISSED, now)
        out['detail'] = f'Left up. {out["reports_closed"]} open report(s) closed as dismissed.'

    elif action == 'remove':
        if kind == 'user':
            raise ValueError('An account is not taken down from this screen, suspend it from People.')
        if not reason:
            raise ValueError('Say why it is coming down. The author is shown this sentence.')
        if row.status == REMOVED_STATE[kind]:
            raise ValueError(f'That {kind} is already taken down, restore it, or leave it down.')
        row.status = REMOVED_STATE[kind]
        row.save(update_fields=['status'])
        if kind == 'comment':
            Post.objects.filter(pk=row.post_id).update(comment_count=Greatest(F('comment_count') - 1, 0))
        out['reports_closed'] = close_reports(kind, row.pk, Report.Status.RESOLVED, now)
        campaigns, refunded = cancel_campaigns(kind, row.pk, now)
        out['campaigns'], out['refunded'] = campaigns, str(refunded)
        _say(kind, row, actor, suspension_notice(kind, row, actor, reason))
        owner_mail = (f'Your Exposing {kind} was suspended',
                      suspension_notice(kind, row, actor, reason)
                      + '\n\nIt is out of the feed and cannot be seen by anyone else while it is '
                        'suspended. Reason: ' + reason, False)
        if notice_text:
            notice = _notice(kind, row, actor, reason, notice_text, audience)
            out['notice'] = notice_row(notice)
        out['content']['state'] = row.status
        out['detail'] = (
            f'Taken down. {out["reports_closed"]} report(s) closed'
            + (f', {len(campaigns)} campaign(s) cancelled' if campaigns else '')
            + (f', {refunded} coins refunded' if refunded else '')
            + (' + a notice only they read' if audience == PublicNotice.Audience.PRIVATE and out['notice']
               else ' + a public notice' if out['notice'] else '')
            + '.'
        )

    elif action == 'warn':
        if not notice_text:
            raise ValueError('Write the sentence they are shown.')
        notice = _notice(kind, row, actor, reason, notice_text, audience)
        out['notice'] = notice_row(notice)
        out['reports_closed'] = close_reports(kind, row.pk, Report.Status.RESOLVED, now)
        _say(kind, row, actor, notice_text, notice=notice)
        owner_mail = ('A note from the Exposing team', notice_text, True)
        out['detail'] = (
            f'Left up with a notice {"only the author reads" if audience == PublicNotice.Audience.PRIVATE else "everyone reads"}. '
            f'{out["reports_closed"]} report(s) closed as resolved.'
        )

    elif action == 'release':
        if kind == 'user':
            raise ValueError('An account is not released, it is suspended or it is not.')
        if kind not in HIDDEN_STATE:
            raise ValueError('A listing is never held pending review: it is up, or it is taken down.')
        if row.status != HIDDEN_STATE[kind]:
            raise ValueError('Only content hidden pending review can be released.')
        row.status = LIVE_STATE[kind]
        row.save(update_fields=['status'])
        if kind == 'comment':
            Post.objects.filter(pk=row.post_id).update(comment_count=F('comment_count') + 1)
        out['reports_closed'] = close_reports(kind, row.pk, Report.Status.DISMISSED, now)
        _say(kind, row, actor, f'Your {kind} was reviewed and is back in the feed.')
        out['detail'] = (
            f'Back in the feed. {out["reports_closed"]} report(s) closed, so the next report '
            'cannot re-hide it on the old pile.'
        )

    else:  # restore
        if kind == 'user':
            raise ValueError('An account is reinstated from People, not here.')
        if row.status != REMOVED_STATE[kind]:
            raise ValueError('Only something already taken down can be restored.')
        row.status = LIVE_STATE[kind]
        row.save(update_fields=['status'])
        if kind == 'comment':
            Post.objects.filter(pk=row.post_id).update(comment_count=F('comment_count') + 1)
        _say(kind, row, actor, f'Your {kind} was restored by moderation.')
        out['detail'] = 'Restored. The author is told it is back.'

    record(actor, AUDIT[action], f'{kind}:{row.pk}', reason or out['detail'])
    if owner_mail:
        subject, body, warning = owner_mail
        mailed = out['emailed'] = email_owner(kind, row, subject, body, warning=warning)
        out['detail'] += (
            f' A copy is on its way to {mailed["to"]}.' if mailed
            else ' Nothing was emailed: that account has no address, or asks not to be written to.'
        )
    # The preview is rebuilt from the row as it now stands, so the console can
    # paint the decision it just made without a second read of the queue.
    out['content'] = preview(kind, row)
    return out


def decide(report, actor, action, reason='', notice_text='', audience=PublicNotice.Audience.PUBLIC):
    """`act()` with the report that started it, so the queue can re-render one row."""
    out = act(report.target_type, report.target_id, actor, action, reason, notice_text, audience)
    out['report'] = report.pk
    return out
