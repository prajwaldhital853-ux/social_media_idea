"""Alerts: the handful of conditions worth interrupting a client for, and their history.

`scan()` reads live state and upserts one row per condition, keyed so a problem
that lasts an hour stays one alert with `occurrences` climbing instead of pushing
sixty copies into the feed. Anything that cannot be seen from the tables the site
writes is not an alert here — a warning nobody can act on is noise, and the
thresholds live in `settings_store` so 6.9 can move them without a deploy.
"""

from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from apps.moderation.models import AuditLog, Report
from apps.wallet.models import CoinRequest

from . import settings_store
from .models import AdminAlert, StaffAccount
from .stats import storage_used


def _raise(key, kind, title, detail, href, severity=AdminAlert.Severity.WARNING, context=None):
    """Open the alert, or re-stamp the one already open.

    A row that a person resolved and that happens again reopens: the alternative
    is a second row for the same trouble, which reads as two problems.
    """
    now = timezone.now()
    row = AdminAlert.objects.filter(key=key).first()
    if row is None:
        return AdminAlert.objects.create(
            key=key, kind=kind, title=title[:160], detail=detail[:240], href=href,
            severity=severity, context=context or {},
        )
    row.occurrences += 1
    row.last_seen = now
    row.title = title[:160]
    row.detail = detail[:240]
    row.href = href
    row.severity = severity
    row.context = context or {}
    if row.status == AdminAlert.Status.RESOLVED:
        row.status = AdminAlert.Status.OPEN
        row.resolved_at = None
    row.save(update_fields=[
        'occurrences', 'last_seen', 'title', 'detail', 'href', 'severity', 'context', 'status', 'resolved_at',
    ])
    return row


def _close(keys):
    """Silence anything that no longer holds, so the feed cannot lie about a fixed problem."""
    AdminAlert.objects.filter(status__in=(AdminAlert.Status.OPEN, AdminAlert.Status.ACKED)).exclude(
        key__in=keys,
    ).update(status=AdminAlert.Status.RESOLVED, resolved_at=timezone.now())


def _report_piles(limit, now):
    """One post, many distinct reporters: the pile that pulled it out of the feed."""
    rows = (
        Report.objects.filter(target_type=Report.Target.POST, status=Report.Status.OPEN)
        .values('target_id')
        .annotate(reporters=Count('reporter', distinct=True), newest=Count('pk'))
        .filter(reporters__gte=limit)
        .order_by('-reporters')[:10]
    )
    found = {}
    for row in rows:
        key = f'report_pile:post:{row["target_id"]}'
        found[key] = _raise(
            key, 'report_pile',
            f'A post is sitting on {row["reporters"]} open reports',
            f'{row["newest"]} reports name post {row["target_id"]}. It stays hidden until someone rules on it.',
            '/reports?target=post&status=open',
            context={'post_id': row['target_id'], 'reporters': row['reporters']},
        )
    return found


def _ageing_reports(hours, now):
    cutoff = now - timedelta(hours=hours)
    stale = Report.objects.filter(status__in=(Report.Status.OPEN, Report.Status.REVIEWING), created_at__lt=cutoff)
    count = stale.count()
    if not count:
        return {}
    oldest = stale.order_by('created_at').first()
    days = (now - oldest.created_at).days if oldest else 0
    return {
        'report_ageing': _raise(
            'report_ageing', 'report_ageing',
            f'{count} reports have gone unanswered',
            f'Nothing has been decided on these for over {hours} hours; the oldest is {days} days in.',
            '/reports?status=open',
            severity=AdminAlert.Severity.CRITICAL if count >= 20 else AdminAlert.Severity.WARNING,
            context={'count': count, 'hours': hours},
        ),
    }


def _ageing_coin_queue(hours, now):
    cutoff = now - timedelta(hours=hours)
    waiting = CoinRequest.objects.filter(status=CoinRequest.Status.PENDING, created_at__lt=cutoff)
    count = waiting.count()
    if not count:
        return {}
    coins = sum(row.coins for row in waiting)
    return {
        'coin_queue_ageing': _raise(
            'coin_queue_ageing', 'coin_queue_ageing',
            f'{count} people are waiting on coins',
            f'Their payment proofs are older than {hours} hours. {coins} coins are held up behind the review.',
            '/coins?status=pending',
            context={'count': count, 'coins': coins, 'hours': hours},
        ),
    }


def _autohide_wave(limit, now):
    since = now - timedelta(days=1)
    hides = AuditLog.objects.filter(action='auto_hide_post', created_at__gte=since).count()
    if hides < limit:
        return {}
    # The number worth naming is the one a person can move: how many reports pull
    # a post out of the feed, which is what produced this pile of hidden content.
    pile = settings_store.get('alert_report_pile')
    return {
        'autohide_wave': _raise(
            'autohide_wave', 'autohide_wave',
            f'{hides} posts hid themselves today',
            f'Moderation pulled this much content on report counts alone in 24 hours. Either a wave of spam '
            f'or a pile threshold set too low ({pile}).',
            '/reports?status=open',
            severity=AdminAlert.Severity.CRITICAL,
            context={'hides': hides, 'limit': limit, 'pile': pile},
        ),
    }


def _staff_lockouts(limit, now):
    since = now - timedelta(hours=1)
    rows = StaffAccount.objects.filter(totp_locked_until__gt=now)
    counted = rows.filter(login_locked_until__gt=now).count()
    recent = rows.filter(totp_locked_until__gte=since).count()
    total = max(counted, recent)
    if total < limit:
        return {}
    return {
        'staff_lockouts': _raise(
            'staff_lockouts', 'staff_lockouts',
            f'{total} staff seats are locked out',
            'Wrong authenticator codes five times in a row locks a seat for fifteen minutes. Either someone '
            'lost their phone or someone is trying to get in.',
            '/access?state=locked',
            severity=AdminAlert.Severity.CRITICAL,
            context={'seats': total, 'password_locks': counted},
        ),
    }


def _storage(media, limit_gb, now):
    if media['state'] != 'ok':
        return {}
    used_gb = media['bytes'] / 1024.0 ** 3
    if used_gb < float(limit_gb):
        return {}
    return {
        'storage_high': _raise(
            'storage_high', 'storage_high',
            f'Uploads have passed {limit_gb} GB',
            f'{round(used_gb, 2)} GB across {media["files"]} files. A disk fills silently and then posts stop saving.',
            '/settings',
            context={'bytes': media['bytes'], 'files': media['files'], 'limit_gb': float(limit_gb)},
        ),
    }


def scan(now=None, media=None):
    """Every condition, once, against the thresholds as they stand right now."""
    now = now or timezone.now()
    thresholds = settings_store.values()
    media = media if media is not None else storage_used()

    found = {}
    found.update(_report_piles(thresholds['alert_report_pile'], now))
    found.update(_ageing_reports(thresholds['alert_report_age_hours'], now))
    found.update(_ageing_coin_queue(thresholds['alert_coin_queue_hours'], now))
    found.update(_autohide_wave(thresholds['alert_autohide_day'], now))
    found.update(_staff_lockouts(thresholds['alert_staff_lockouts'], now))
    found.update(_storage(media, thresholds['alert_storage_gb'], now))

    _close(set(found))
    return list(found.values())


def feed(limit=12):
    """What the dashboard shows: open first, then the trail of what was closed."""
    rows = AdminAlert.objects.select_related('acked_by')[:limit]
    return [
        {
            'id': row.pk,
            'key': row.key,
            'kind': row.kind,
            'severity': row.severity,
            'status': row.status,
            'title': row.title,
            'detail': row.detail,
            'href': row.href,
            'context': row.context,
            'occurrences': row.occurrences,
            'first_seen': row.first_seen,
            'last_seen': row.last_seen,
            'resolved_at': row.resolved_at,
            'acked_by': row.acked_by.username if row.acked_by else None,
        }
        for row in rows
    ]


def counts():
    by = AdminAlert.objects.values('status').annotate(n=Count('pk'))
    out = {row['status']: row['n'] for row in by}
    return {
        'open': out.get(AdminAlert.Status.OPEN, 0),
        'acked': out.get(AdminAlert.Status.ACKED, 0),
        'resolved': out.get(AdminAlert.Status.RESOLVED, 0),
    }
