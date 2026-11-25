"""Contract 6.9: the five files a seat downloads instead of copying a screen.

Users, Reports, Coin Requests, Coin Ledger, Promotions, the tables the Client has
to hand to an accountant, a lawyer or an auditor. Each is read straight out of the
member site's own rows, in the order the queue shows them, with the staff decisions
the console keeps beside them; nothing here is a second copy of the data that could
drift from the truth.

Two rules shape the file. Every column is named in words a person outside this
platform understands, because a CSV is read by somebody who has never seen the
admin screens. And every export is itself an audit entry: "who took a file
containing 4,112 members' email addresses, and when" is exactly the kind of staff
action 6.9 promises to record.
"""

import csv
import io
from datetime import datetime, time as time_of_day

from django.db.models import Count, Q
from django.utils import timezone

from apps.accounts.models import User
from apps.moderation.models import Report
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.wallet.models import CoinRequest, Transaction

from .journal import record
from .models import CoinReview, PromoReview

# A file is a download, not a data dump: past this many rows the response says so in
# a header and the screen says so in words, rather than silently handing over half.
MAX_ROWS = 50000

COLUMNS = {
    'users': ['id', 'username', 'name', 'email', 'provider', 'email_verified', 'country', 'city',
              'joined', 'last_login', 'role', 'staff_seat', 'verified_profile', 'coins', 'posts', 'listings',
              'followers', 'state', 'suspended_until', 'suspension_reason', 'locked_until'],
    'reports': ['id', 'created_at', 'status', 'target_type', 'target_id', 'reason', 'details',
                'reporter_id', 'reporter_username', 'resolved_at'],
    'coin_requests': ['id', 'created_at', 'user_id', 'username', 'coins', 'amount_npr', 'method', 'reference',
                      'status', 'reviewed_at', 'decided_by', 'decision', 'decision_reason', 'proof_retained'],
    'coin_ledger': ['id', 'created_at', 'username', 'kind', 'coins', 'note'],
    'promotions': ['id', 'created_at', 'user_id', 'username', 'target_type', 'target_id', 'category', 'package',
                   'status', 'budget_coins', 'impressions', 'clicks', 'ends_at', 'decided_by', 'decision'],
}

LABELS = {
    'users': ('Members', 'Every account on the platform, with what it holds and what was done to it.'),
    'reports': ('Reports', 'Every complaint a member filed, what it pointed at and how it ended.'),
    'coin_requests': ('Coin requests', 'Every purchase asked for, with the decision the coin desk made on it.'),
    'coin_ledger': ('Coin ledger', 'The append-only record of coins credited and spent.'),
    'promotions': ('Promotions', 'Every paid campaign, what it cost and what it reached.'),
}

NAMES = tuple(LABELS)


def _state(user, now):
    if not user.is_active:
        return 'deactivated'
    if user.suspended_until and user.suspended_until > now:
        return 'suspended'
    if user.locked_until and user.locked_until > now:
        return 'locked'
    return 'active'


def _users(since, until):
    """Every account, joined the way the people directory joins it.

    Live posts only: a seat reconciling a member file wants what a person has out
    there now, and the same rule is what the directory counts on screen.
    """
    rows = (
        User.objects.select_related('profile', 'staff_account', 'wallet')
        .annotate(
            posts_count=Count('posts', filter=Q(posts__status=Post.Status.LIVE), distinct=True),
            listings_count=Count('listings', distinct=True),
            followers_count=Count('followers', filter=Q(followers__status='accepted'), distinct=True),
        )
    )
    if since:
        rows = rows.filter(date_joined__gte=since)
    if until:
        rows = rows.filter(date_joined__lte=until)
    now = timezone.now()
    for item in rows.order_by('date_joined', 'pk').iterator():
        # A reverse one-to-one that has no row raises, and what it raises is an
        # `AttributeError` subclass, so `getattr` with a default is the read that
        # does not need a try block per member.
        profile = getattr(item, 'profile', None)
        seat = getattr(item, 'staff_account', None)
        wallet = getattr(item, 'wallet', None)
        yield [
            item.pk, item.username,
            (profile.display_name if profile else '') or item.get_full_name() or item.username,
            item.email, item.provider, 'yes' if item.email_verified else 'no', item.country, item.city,
            _stamp(item.date_joined), _stamp(item.last_login),
            'superadmin' if item.is_superuser else 'staff' if item.is_staff else 'member',
            seat.role if seat else '', 'yes' if profile and profile.verified else 'no',
            int(wallet.balance or 0) if wallet else 0,
            item.posts_count, item.listings_count, item.followers_count,
            _state(item, now), _stamp(item.suspended_until), item.suspend_reason, _stamp(item.locked_until),
        ]


def _stamp(value):
    return value.strftime('%Y-%m-%d %H:%M:%S') if value else ''


def _reports(since, until):
    rows = Report.objects.select_related('reporter')
    if since:
        rows = rows.filter(created_at__gte=since)
    if until:
        rows = rows.filter(created_at__lte=until)
    for item in rows.order_by('created_at', 'pk').iterator():
        yield [
            item.pk, _stamp(item.created_at), item.status, item.target_type, item.target_id,
            item.reason, item.details, item.reporter_id, item.reporter.username, _stamp(item.resolved_at),
        ]


def _last_reviews(model, foreign):
    """(id → (actor, action, reason)) for the newest staff decision on each row."""
    out = {}
    for item in model.objects.select_related('actor').order_by(foreign, 'created_at', 'pk').iterator():
        out[getattr(item, f'{foreign}_id')] = (
            item.actor.username if item.actor else '', item.action, item.reason,
        )
    return out


def _coin_requests(since, until):
    rows = CoinRequest.objects.select_related('user')
    if since:
        rows = rows.filter(created_at__gte=since)
    if until:
        rows = rows.filter(created_at__lte=until)
    decided = _last_reviews(CoinReview, 'request')
    for item in rows.order_by('created_at', 'pk').iterator():
        by, action, reason = decided.get(item.pk, ('', '', ''))
        yield [
            item.pk, _stamp(item.created_at), item.user_id, item.user.username, item.coins,
            f'{item.amount:.2f}', item.method, item.reference, item.status, _stamp(item.reviewed_at),
            by, action, reason, 'yes' if item.screenshot_url else 'no',
        ]


def _ledger(since, until):
    rows = Transaction.objects.select_related('wallet', 'wallet__user')
    if since:
        rows = rows.filter(created_at__gte=since)
    if until:
        rows = rows.filter(created_at__lte=until)
    for item in rows.order_by('created_at', 'pk').iterator():
        yield [
            item.pk, _stamp(item.created_at), item.wallet.user.username, item.kind,
            f'{item.amount:.2f}', item.note,
        ]


def _promotions(since, until):
    rows = Promotion.objects.select_related('owner')
    if since:
        rows = rows.filter(created_at__gte=since)
    if until:
        rows = rows.filter(created_at__lte=until)
    decided = _last_reviews(PromoReview, 'promotion')
    for item in rows.order_by('created_at', 'pk').iterator():
        by, action = decided.get(item.pk, ('', ''))[:2]
        yield [
            item.pk, _stamp(item.created_at), item.owner_id, item.owner.username, item.target_type,
            item.target_id, item.category, item.package, item.status, f'{item.budget:.2f}',
            item.impressions, item.clicks, _stamp(item.ends_at), by, action,
        ]


BUILDERS = {
    'users': _users,
    'reports': _reports,
    'coin_requests': _coin_requests,
    'coin_ledger': _ledger,
    'promotions': _promotions,
}


def day_boundaries(since='', until=''):
    """`2026-11-01` to a window that ends at the last second of `2026-11-22`.

    A date with no clock on it means a whole day to the person who typed it, so the
    end of the range is a day's last second rather than its first, a file that
    quietly drops the twenty-second of November is a file nobody reconciles.
    """
    def parse(raw, end=False):
        raw = (raw or '').strip()
        if not raw:
            return None
        try:
            stamp = datetime.strptime(raw[:10], '%Y-%m-%d')
        except ValueError:
            return None
        aware = timezone.make_aware(
            stamp if not end else stamp.replace(hour=time_of_day.max.hour,
                                               minute=time_of_day.max.minute, second=time_of_day.max.second),
        )
        return aware
    return parse(since), parse(until, end=True)


def name_for(dataset, since=None, until=None):
    """`exposing-users-2026-11-01-to-2026-11-22.csv`, or the whole table dated today.

    The window is in the filename because somebody will end up with five of these in
    a downloads folder a month from now, and a file that cannot say which months it
    covers is a file an auditor asks about.
    """
    window = (
        f'{since:%Y-%m-%d}-to-{until:%Y-%m-%d}' if since and until
        else f'from-{since:%Y-%m-%d}' if since
        else f'to-{until:%Y-%m-%d}' if until
        else timezone.now().strftime('%Y-%m-%d')
    )
    return f'exposing-{dataset}-{window}.csv'


def index(since=None, until=None):
    """What each file would contain right now, the counts a seat checks before clicking."""
    out = []
    for key, (label, blurb) in LABELS.items():
        rows = _model_for(key).objects
        if since:
            rows = rows.filter(**{_window(key)[0] + '__gte': since})
        if until:
            rows = rows.filter(**{_window(key)[1] + '__lte': until})
        out.append({
            'id': key, 'label': label, 'blurb': blurb,
            'columns': COLUMNS[key], 'rows': rows.count(),
        })
    return out


def _model_for(key):
    return {'users': User, 'reports': Report, 'coin_requests': CoinRequest,
            'coin_ledger': Transaction, 'promotions': Promotion}[key]


def _window(key):
    return {'users': ('date_joined', 'date_joined'), 'reports': ('created_at', 'created_at'),
            'coin_requests': ('created_at', 'created_at'), 'coin_ledger': ('created_at', 'created_at'),
            'promotions': ('created_at', 'created_at')}[key]


def build(actor, dataset, since=None, until=None):
    """(code, body). The body carries the file as text, in one piece, and what it holds.

    A seat cannot be asked to trust a download it cannot see the shape of, so the
    answer names the filename, counts the rows and says out loud when the window was
    cut short, and the same call writes the audit entry that says who took it.
    """
    if dataset not in BUILDERS:
        return 404, {'detail': 'Choose one of: ' + ', '.join(NAMES) + '.'}
    buffer = io.StringIO(newline='')
    writer = csv.writer(buffer)
    writer.writerow(COLUMNS[dataset])
    count = 0
    truncated = False
    for line in BUILDERS[dataset](since, until):
        if count >= MAX_ROWS:
            truncated = True
            break
        writer.writerow(line)
        count += 1
    text = buffer.getvalue()
    stamp = timezone.now()
    filename = name_for(dataset, since, until)
    window = (f'{since:%Y-%m-%d} to {until:%Y-%m-%d}' if since and until
              else f'from {since:%Y-%m-%d}' if since
              else f'to {until:%Y-%m-%d}' if until else 'every row the table holds')
    record(actor, 'export_csv', dataset,
           f'{filename}, {count} rows, {window}.'
           + (' Truncated at the cap.' if truncated else ''))
    return 200, {
        'filename': filename,
        'dataset': dataset,
        'rows': count,
        'columns': COLUMNS[dataset],
        'truncated': truncated,
        'detail': f'{filename}: {count:,} row(s) of {LABELS[dataset][0].lower()}, {window}.'
                  + (' Cut at 50,000 rows, narrow the dates for the rest.' if truncated else ''),
        'csv': text,
        'taken_at': stamp,
    }
