"""The reads behind the dashboard: counts over windows, daily series, health, campaign results.

Two rules shape this file. Every number is derived from tables the site already
writes, so nothing here is a shadow counter that can drift from the truth. And a
number with no source is reported as missing rather than as zero: the contract
asks for profile visits and listing messages, and a flat 0 would tell a client
their campaign did nothing when in fact nothing measures it.
"""

import os
import time
from datetime import datetime, time as time_of_day, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.models import Count, DecimalField, Q, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from apps.accounts.models import User
from apps.comments.models import Comment
from apps.follows.models import Follow
from apps.marketplace.models import Listing
from apps.moderation.models import AuditLog, Report
from apps.posts.models import Post, PostMedia
from apps.promotions.models import Promotion
from apps.reactions.models import Reaction
from apps.saved.models import SavedListing, SavedPost
from apps.wallet.models import CoinRequest, Transaction

from . import settings_store

SERIES_DAYS = 14
OPEN_STATES = (Report.Status.OPEN, Report.Status.REVIEWING)
CLOSED_STATES = (Report.Status.RESOLVED, Report.Status.DISMISSED)
STORAGE_CACHE_KEY = 'adminpanel:storage'
STORAGE_CACHE_SECONDS = 300
_MONEY = DecimalField(max_digits=14, decimal_places=2)

# The windows every dashboard card can be cut to, in the order its picker shows
# them. A month is 30 days and a year 365 because the card says "last", not
# "this calendar month" — the calendar reading belongs to the desks below it.
WINDOW_DAYS = (('24h', 1), ('3d', 3), ('7d', 7), ('1m', 30), ('6m', 182), ('1y', 365))


def _total(queryset, field, money=False):
    """COALESCE keeps an empty window at zero, which is an answer; None is not."""
    aggregate = queryset.aggregate(
        total=Coalesce(Sum(field), 0, output_field=_MONEY if money else None),
    )['total']
    return Decimal(aggregate or 0) if money else int(aggregate or 0)


def windows(now=None):
    """The three cutoffs the contract names, plus where the sparkline starts.

    "Today" is the calendar day, not the last 24 hours: a client reading "7 new
    accounts today" at eleven at night means since breakfast. Midnight here is
    UTC because that is the platform's zone.
    """
    now = now or timezone.now()
    day_start = timezone.make_aware(datetime.combine(timezone.localdate(now), time_of_day.min))
    return {
        'now': now,
        'today': day_start,
        'week': now - timedelta(days=7),
        'month': now - timedelta(days=30),
        'series': day_start - timedelta(days=SERIES_DAYS - 1),
    }


def _windows(queryset, cutoffs, field='created_at', amount=None):
    """The same pile cut to every window a card offers, in one pass per window.

    Six aggregates answered up front rather than a fresh request on each pick:
    the dashboard is read by a handful of seats, and a card that made the person
    wait on the database to change its own heading would feel broken, not careful.
    """
    out = {}
    for key, days in WINDOW_DAYS:
        rows = queryset.filter(**{f'{field}__gte': cutoffs['now'] - timedelta(days=days)})
        out[key] = int(_total(rows, amount, money=True)) if amount else rows.count()
    return out


def _daily(queryset, since, field='created_at', amount=None):
    """One bucket per day with no holes, so a sparkline cannot skip a weekend."""
    aggregate = Coalesce(Sum('amount'), 0, output_field=_MONEY) if amount else Count('pk')
    rows = (
        queryset.filter(**{f'{field}__gte': since})
        .annotate(day=TruncDate(field))
        .values('day')
        .annotate(n=aggregate)
    )
    found = {row['day']: int(row['n'] or 0) for row in rows if row['day']}
    first = since.date()
    out = []
    day = first
    while day <= first + timedelta(days=SERIES_DAYS - 1):
        out.append({'day': day.isoformat(), 'n': found.get(day, 0)})
        day += timedelta(days=1)
    return out


def _rate_tile(tile_id, label, href, model, field, cutoffs):
    def counted(since):
        return model.objects.filter(**{f'{field}__gte': since}).count()

    windowed = model.objects.filter(**{f'{field}__gte': cutoffs['series']})
    return {
        'id': tile_id,
        'kind': 'rate',
        'label': label,
        'href': href,
        'today': counted(cutoffs['today']),
        'week': counted(cutoffs['week']),
        'month': counted(cutoffs['month']),
        'total': model.objects.count(),
        'windows': _windows(model.objects.all(), cutoffs, field),
        'series': _daily(windowed, cutoffs['series'], field),
    }


def _open_reports(cutoffs):
    open_qs = Report.objects.filter(status__in=OPEN_STATES)
    oldest = open_qs.order_by('created_at').first()
    return {
        'id': 'open_reports',
        'kind': 'queue',
        'label': 'Open reports',
        'href': '/reports',
        'value': open_qs.count(),
        'new_today': open_qs.filter(created_at__gte=cutoffs['today']).count(),
        'windows': _windows(open_qs, cutoffs),
        'closed_week': Report.objects.filter(
            status__in=CLOSED_STATES, resolved_at__gte=cutoffs['week'],
        ).count(),
        'by_target': dict(open_qs.values('target_type').annotate(n=Count('pk')).values_list('target_type', 'n')),
        'by_reason': [
            {'reason': row['reason'], 'n': row['n']}
            for row in open_qs.values('reason').annotate(n=Count('pk')).order_by('-n')[:5]
        ],
        'oldest_minutes': int((cutoffs['now'] - oldest.created_at).total_seconds() // 60) if oldest else 0,
    }


def _coin_requests(cutoffs):
    pending = CoinRequest.objects.filter(status=CoinRequest.Status.PENDING)
    approved = CoinRequest.objects.filter(status=CoinRequest.Status.APPROVED)
    sold_month = approved.filter(reviewed_at__gte=cutoffs['month'])
    oldest = pending.order_by('created_at').first()
    return {
        'id': 'coin_requests',
        'kind': 'coins',
        'label': 'Coins and payments',
        'href': '/coins',
        'pending': pending.count(),
        'windows': _windows(pending, cutoffs),
        'pending_coins': _total(pending, 'coins'),
        'pending_npr': float(_total(pending, 'amount', money=True)),
        'waiting_today': pending.filter(created_at__gte=cutoffs['today']).count(),
        'oldest_minutes': int((cutoffs['now'] - oldest.created_at).total_seconds() // 60) if oldest else 0,
        'sold_today': _total(approved.filter(reviewed_at__gte=cutoffs['today']), 'coins'),
        'sold_week': _total(approved.filter(reviewed_at__gte=cutoffs['week']), 'coins'),
        'sold_month': _total(sold_month, 'coins'),
        'collected_npr': float(_total(sold_month, 'amount', money=True)),
    }


def _promotions(cutoffs):
    # `pending` is the state an ordered-but-not-yet-charged campaign sits in, so it is
    # what "pending promotions" means here. Reporting active rows would double-count
    # them on this screen.
    running = Promotion.objects.filter(status=Promotion.Status.ACTIVE).exclude(
        Q(ends_at__isnull=False, ends_at__lt=cutoffs['now']),
    )
    return {
        'id': 'promotions',
        'kind': 'promotions',
        'label': 'Promotions',
        'href': '/promotions',
        'active': running.count(),
        'windows': _windows(Promotion.objects.all(), cutoffs),
        'awaiting_review': Promotion.objects.filter(status=Promotion.Status.PENDING).count(),
        'paused': Promotion.objects.filter(status=Promotion.Status.PAUSED).count(),
        'started_month': Promotion.objects.filter(created_at__gte=cutoffs['month']).count(),
        'impressions_month': _total(Promotion.objects.filter(created_at__gte=cutoffs['month']), 'impressions'),
        'clicks_month': _total(Promotion.objects.filter(created_at__gte=cutoffs['month']), 'clicks'),
    }


def _coins_moved(cutoffs):
    """Coins on the append-only ledger: credit is bought in, debit is spent.

    The ledger column is a Decimal, so the sums ask for the money path, Postgres
    will not type an untyped `0` against a numeric column, and are then read
    back as whole coins, which is all a dashboard tile can show.
    """
    debit = Transaction.objects.filter(kind=Transaction.Kind.DEBIT)
    credit = Transaction.objects.filter(kind=Transaction.Kind.CREDIT)

    def coins(queryset):
        return int(_total(queryset, 'amount', money=True))

    return {
        'id': 'coins_moved',
        'kind': 'ledger',
        'label': 'Coins spent',
        'href': '/ledger',
        'spent_today': coins(debit.filter(created_at__gte=cutoffs['today'])),
        'windows': _windows(debit, cutoffs, amount='amount'),
        'spent_week': coins(debit.filter(created_at__gte=cutoffs['week'])),
        'spent_month': coins(debit.filter(created_at__gte=cutoffs['month'])),
        'credited_month': coins(credit.filter(created_at__gte=cutoffs['month'])),
        'series': _daily(debit.filter(created_at__gte=cutoffs['series']), cutoffs['series'], amount=True),
    }


def storage_used(refresh=False):
    """Bytes under MEDIA_ROOT, cached: a directory walk is the one number here
    that is not a query, and this screen re-reads it every time it is opened.

    A deployed API may have no disk at all, which is reported as `unknown`, the
    difference between "nothing stored" and "cannot tell" is the whole point.
    """
    if not refresh:
        hit = cache.get(STORAGE_CACHE_KEY)
        if hit is not None:
            return hit
    root = str(settings.MEDIA_ROOT)
    payload = {'bytes': 0, 'files': 0, 'by_kind': {}, 'state': 'unknown', 'detail': ''}
    if not os.path.isdir(root):
        payload['detail'] = 'No media directory on this server.'
    else:
        started = time.time()
        kinds, total, files = {}, 0, 0
        for dirpath, _dirs, names in os.walk(root):
            for name in names:
                try:
                    size = os.path.getsize(os.path.join(dirpath, name))
                except OSError:
                    continue
                extension = os.path.splitext(name)[-1].lower().lstrip('.') or 'other'
                kinds[extension] = kinds.get(extension, 0) + 1
                total += size
                files += 1
        payload.update({
            'bytes': total,
            'files': files,
            'by_kind': dict(sorted(kinds.items(), key=lambda kv: -kv[1])[:6]),
            'state': 'ok',
            'detail': f'{files} files scanned in {round(time.time() - started, 2)}s.',
            'measured_at': int(time.time()),
        })
    cache.set(STORAGE_CACHE_KEY, payload, STORAGE_CACHE_SECONDS)
    return payload


def _storage_tile(media):
    limit = settings_store.get('alert_storage_gb')
    return {
        'id': 'storage',
        'kind': 'storage',
        'label': 'Storage used',
        'href': '/settings',
        'bytes': media['bytes'],
        'files': media['files'],
        'state': media['state'],
        'by_kind': media['by_kind'],
        'detail': media['detail'],
        'limit_gb': float(limit),
    }


def tiles(cutoffs, media=None):
    """The overview cards, in the order the contract lists them."""
    media = media if media is not None else storage_used()
    out = [
        _rate_tile('new_users', 'New accounts', '/users', User, 'date_joined', cutoffs),
        _rate_tile('posts', 'Posts created', '/content', Post, 'created_at', cutoffs),
        _rate_tile('comments', 'Comments created', '/content', Comment, 'created_at', cutoffs),
        _rate_tile('listings', 'Listings created', '/listings', Listing, 'created_at', cutoffs),
        _open_reports(cutoffs),
        _coin_requests(cutoffs),
        _promotions(cutoffs),
        _storage_tile(media),
        _coins_moved(cutoffs),
    ]
    return out


# --- system health -----------------------------------------------------------

STATE_RANK = ('down', 'off', 'degraded', 'slow', 'unknown', 'ok')


def health(cutoffs, media=None):
    """Whether the platform can be trusted to answer the rest of this screen."""
    media = media if media is not None else storage_used()
    checks = []

    started = time.time()
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
        cursor.fetchone()
    latency = round((time.time() - started) * 1000, 1)
    checks.append({
        'id': 'database', 'label': 'Database',
        'state': 'ok' if latency < 1500 else 'slow',
        'detail': f'{connection.vendor.title()} answered in {latency} ms.',
    })

    cache_up = False
    try:
        cache.set('adminpanel:probe', 1, 10)
        cache_up = cache.get('adminpanel:probe') == 1
    except Exception:
        cache_up = False
    redis = bool(getattr(settings, 'REDIS_AVAILABLE', False))
    checks.append({
        'id': 'cache', 'label': 'Cache and rate limiting',
        'state': 'ok' if cache_up and redis else 'degraded' if cache_up else 'down',
        'detail': 'Redis holds the rate-limit counters.' if cache_up and redis else
                  'Local-memory cache: limits reset when a worker restarts.' if cache_up else
                  'The cache is not answering, so limits and lockouts cannot be trusted.',
    })

    mail = getattr(settings, 'EMAIL_BACKEND', '')
    mail_ready = not mail.endswith('console.EmailBackend')
    checks.append({
        'id': 'email', 'label': 'Email delivery',
        'state': 'ok' if mail_ready else 'degraded',
        'detail': 'Suspensions and warning notices are emailed.' if mail_ready else
                  'Console backend, so mail is printed rather than sent. Set EMAIL_BACKEND before launch.',
    })

    limits_on = bool(getattr(settings, 'EXPOSING_RATE_LIMITS', True))
    checks.append({
        'id': 'ratelimits', 'label': 'Rate limiting',
        'state': 'ok' if limits_on else 'off',
        'detail': 'On for sign-in, posting and search.' if limits_on else
                  'EXPOSING_RATE_LIMITS is off, this is a test box, not a live one.',
    })

    checks.append({
        'id': 'media', 'label': 'Uploads readable',
        'state': 'ok' if media['state'] == 'ok' else 'unknown',
        'detail': media['detail'] or 'No media directory on this server.',
    })

    checks.append({
        'id': 'audit', 'label': 'Audit trail',
        'state': 'ok',
        'detail': f'{AuditLog.objects.filter(created_at__gte=cutoffs["week"]).count()} staff actions logged this week.',
    })

    worst = min((check['state'] for check in checks), key=STATE_RANK.index)
    return {'state': worst, 'checks': checks}


# --- promotion performance ---------------------------------------------------

# The contract's nine metrics. Every one of them has an event behind it now: the last
# one used to be the honest gap — a message carried no listing id, so no campaign
# could be credited with it. The chat now knows which advert walked the reader in, and
# counts the sentence that was actually sent rather than the button that was tapped.
METRIC_LABELS = (
    ('views', 'Views'),
    ('opens', 'Opens'),
    ('profile_visits', 'Profile visits'),
    ('reactions', 'Reactions'),
    ('comments', 'Comments'),
    ('saves', 'Saves'),
    ('new_followers', 'New followers'),
    ('messages', 'Messages'),
    ('coins_spent', 'Coins spent'),
)
UNMEASURED = {}


def _window_of(promo, now):
    # The window is the part the payer paid for. That begins when approval took the
    # coins, not when the order was written down, and an order nobody has approved has
    # no window at all, counting a week of organic likes into it would sell the desk
    # reach the campaign never bought.
    if promo.starts_at is None and promo.status in (Promotion.Status.DRAFT, Promotion.Status.PENDING):
        return now, now
    start = promo.starts_at or promo.created_at
    end = promo.ends_at or now
    return start, end if end > start else now


def _post_media_ids(target_id):
    try:
        return [str(pk) for pk in PostMedia.objects.filter(post_id=int(target_id)).values_list('pk', flat=True)]
    except (TypeError, ValueError):
        return []


def promotion_row(promo, now):
    """What one campaign achieved, counted only inside the window it was live."""
    start, end = _window_of(promo, now)
    span = {'created_at__gte': start, 'created_at__lt': end}
    target = str(promo.target_id)

    if promo.target_type == Promotion.Target.POST:
        reactions = Reaction.objects.filter(target_type='post', target_id=target, **span).count()
        reactions += Reaction.objects.filter(target_type='media', target_id__in=_post_media_ids(target), **span).count()
        comments = Comment.objects.filter(post_id=target, **span).count()
        saves = SavedPost.objects.filter(post_id=target, **span).count()
    else:
        reactions = comments = 0
        saves = SavedListing.objects.filter(listing_id=target, **span).count()

    return {
        'id': promo.pk,
        'owner': promo.owner.username,
        'owner_name': promo.owner.get_full_name() or promo.owner.username,
        'target': f'{promo.target_type}:{promo.target_id}',
        'target_type': promo.target_type,
        'package': promo.package,
        'status': promo.status,
        'category': promo.category,
        'started_at': promo.starts_at,
        'ends_at': promo.ends_at,
        'minutes_live': int((min(end, now) - start).total_seconds() // 60) if end > start else 0,
        'metrics': {
            'views': promo.impressions,
            'opens': promo.clicks,
            # The reader's own tap on the paid card, counted once per person per day
            # against the same reach ledger that sold the impression.
            'profile_visits': promo.profile_visits,
            'reactions': reactions,
            'comments': comments,
            'saves': saves,
            'new_followers': Follow.objects.filter(
                followee_id=promo.owner_id, status=Follow.Status.ACCEPTED, **span,
            ).count(),
            # Written by the chat's own door, and only for a reader the reach ledger
            # says this campaign was handed to — so it is a result the money bought.
            'messages': promo.messages,
            # Coins only count as spent once approval has actually taken them; an
            # order still in the queue has cost its payer nothing.
            'coins_spent': int(promo.budget or 0) if promo.starts_at else 0,
        },
        'unmeasured': dict(UNMEASURED),
        'click_rate': round(promo.clicks * 100.0 / promo.impressions, 1) if promo.impressions else None,
    }


def promotion_performance(cutoffs, limit=24, offset=0):
    campaigns = Promotion.objects.select_related('owner').order_by('-created_at')[offset:offset + limit]
    return [promotion_row(promo, cutoffs['now']) for promo in campaigns]


def promotion_count():
    """How many campaigns the performance table could show, page or no page."""
    return Promotion.objects.count()


def performance_totals(rows):
    out = {key: 0 for key, _label in METRIC_LABELS}
    for row in rows:
        for key, value in row['metrics'].items():
            out[key] += value
    return out
