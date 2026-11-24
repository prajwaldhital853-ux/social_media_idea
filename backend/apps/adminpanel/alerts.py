"""Alerts: the handful of conditions worth interrupting a client for, and their history.

`scan()` reads live state and upserts one row per condition, keyed so a problem
that lasts an hour stays one alert with `occurrences` climbing instead of pushing
sixty copies into the feed. Anything that cannot be seen from the tables the site
writes is not an alert here — a warning nobody can act on is noise, and the
thresholds live in `settings_store` so 6.9 can move them without a deploy.

The ten conditions the contract names split three ways. Most are counted straight
out of the site's own tables — a report spike, a signup wave, a coin rush, locked
accounts, an ageing queue. Two are measured from the running server — the database
and the volume the uploads sit on. The rest come from outside this codebase
altogether, and those report in through `AdminPulse`: an uptime probe, a backup job,
an error collector, a transcoder. A pulse that has never been heard of is its own
INFO alert, because "nothing watches the backups yet" is the honest version of a
backup alert and the one a client has to be told before launch.
"""

import os
import shutil
from datetime import timedelta

from django.conf import settings as django_settings
from django.db import connection
from django.db.models import Case, Count, IntegerField, Q, Sum, Value, When
from django.utils import timezone

from apps.accounts.models import User
from apps.moderation.models import AuditLog, Report
from apps.wallet.models import CoinRequest

from . import settings_store, spam, stats
from .journal import record
from .models import AdminAlert, AdminPulse, StaffAccount
from .stats import storage_used

# The outside reporters, and what makes each of them worth interrupting somebody
# for. `window` is the threshold key's value in minutes; `counted` is the number the
# reporter carries with its stamp, and `at` the threshold that number has to reach.
PULSES = {
    'web': {
        'label': 'The public site',
        'stale': 'alert_web_stale_minutes',
        'severity': AdminAlert.Severity.CRITICAL,
        'href': '/alerts',
        'silent': 'Nothing outside this API watches whether the site answers. Until an uptime probe is wired '
                  'in, a page that stops loading will not appear here.',
    },
    'backup': {
        'label': 'Backups',
        'stale': 'alert_backup_stale_hours',
        'hours': True,
        'severity': AdminAlert.Severity.CRITICAL,
        'href': '/exports',
        'silent': 'No backup job has ever reported to this console. A restore would be a rebuild from whatever '
                  'the database holds right now.',
    },
    'errors': {
        # Silence from an error collector is not an alert — a day with no bugs is
        # exactly as quiet as a deploy that stopped shipping them. The number it
        # carries is the signal, so this pulse is read, not timed.
        'label': 'App errors',
        'counted': 'per_hour',
        'at': 'alert_error_rate',
        'severity': AdminAlert.Severity.CRITICAL,
        'href': '/alerts',
        'silent': 'Nothing ships error counts to this console, so a bug that breaks a flow for everybody looks '
                  'from here exactly like a quiet day.',
    },
    'jobs': {
        'label': 'Media processing',
        'stale': 'alert_backlog_minutes',
        'counted': 'waiting',
        'at': 'alert_backlog_jobs',
        'severity': AdminAlert.Severity.WARNING,
        'href': '/content',
        'silent': 'The video and photo pipeline reports nothing here, so a queue of unprocessed uploads would '
                  'be found by a person complaining, not by this console.',
    },
}

# The screen a limit that has run out links back to: the person who reads it
# has to come turn a knob, not open a file.
ALERT_DESK = '/alerts'

# The knobs the alerts desk turns. Every one is a threshold some check above reads.
THRESHOLDS = (
    'alert_report_pile', 'alert_report_age_hours', 'alert_report_spike', 'alert_autohide_day',
    'alert_signup_wave', 'alert_login_locks', 'alert_coin_queue_hours', 'alert_coin_spike',
    'alert_coin_coins_hour', 'alert_storage_gb', 'alert_disk_percent', 'alert_db_size_mb',
    'alert_staff_lockouts', 'alert_web_stale_minutes', 'alert_backup_stale_hours',
    'alert_error_rate', 'alert_backlog_jobs', 'alert_backlog_minutes',
)


def _minutes_since(then, now):
    return int((now - then).total_seconds() // 60)


def _raise(key, kind, title, detail, href, severity=AdminAlert.Severity.WARNING, context=None):
    """Open the alert, or re-stamp the one already open.

    A row that a person resolved and that happens again reopens: the alternative
    is a second row for the same trouble, which reads as two problems.
    """
    now = timezone.now()
    row = AdminAlert.objects.filter(key=key).first()
    if row is None:
        created = AdminAlert.objects.create(
            key=key, kind=kind, title=title[:160], detail=detail[:240], href=href,
            severity=severity, context=context or {},
        )
        _ring(created)
        return created
    row.occurrences += 1
    row.last_seen = now
    row.title = title[:160]
    row.detail = detail[:240]
    row.href = href
    row.severity = severity
    row.context = context or {}
    reopened = row.status == AdminAlert.Status.RESOLVED
    if reopened:
        row.status = AdminAlert.Status.OPEN
        row.resolved_at = None
    row.save(update_fields=[
        'occurrences', 'last_seen', 'title', 'detail', 'href', 'severity', 'context', 'status', 'resolved_at',
    ])
    if reopened:
        _ring(row)
    return row


def _ring(item):
    """A condition nobody has been told about yet goes into the staff bell.

    A re-stamp stays quiet: an alert that has been true all afternoon is already on
    the screen, and a bell that rings once a minute for it gets muted by lunch.
    """
    from . import bell
    if item.severity == AdminAlert.Severity.INFO:
        return
    bell.announce('alert', item.title, item.href or '/alerts', 'alerts')


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
    pile = spam.report_threshold()
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
            ALERT_DESK,
            context={'bytes': media['bytes'], 'files': media['files'], 'limit_gb': float(limit_gb)},
        ),
    }


def _server(now):
    """The two limits a box runs out of that no table records: the volume and the database.

    Both are measured live and both answer `None` when the server will not say — a
    container without a quota, a database engine this helper does not know. An
    unknown is not a zero, and an alert on an unknown is a warning nobody can act on.
    """
    found = {}
    percent = _disk_percent()
    limit = settings_store.get('alert_disk_percent')
    if percent is not None and limit is not None and percent >= float(limit):
        found['disk_high'] = _raise(
            'disk_high', 'disk_high',
            f'The disk is {round(percent)}% full',
            f'{percent and round(percent, 1)}% of the volume the uploads and the database share is used. '
            'At 100% the site keeps reading and stops writing.',
            ALERT_DESK,
            severity=AdminAlert.Severity.CRITICAL if percent >= 95 else AdminAlert.Severity.WARNING,
            context={'percent': round(percent, 1), 'limit': float(limit)},
        )
    size = _db_size_mb()
    ceiling = settings_store.get('alert_db_size_mb')
    if size is not None and ceiling and size >= float(ceiling):
        found['db_large'] = _raise(
            'db_large', 'db_large',
            f'The database is {round(size / 1024, 2)} GB',
            f'{size} MB against a ceiling of {ceiling} MB. Backups, restores and every report query get slower '
            'with it, not just this screen.',
            ALERT_DESK,
            context={'mb': round(size, 1), 'limit': float(ceiling)},
        )
    return found


def _disk_percent():
    root = str(django_settings.MEDIA_ROOT if hasattr(django_settings, 'MEDIA_ROOT') else os.getcwd())
    probe = root if os.path.isdir(root) else os.getcwd()
    try:
        usage = shutil.disk_usage(probe)
    except OSError:
        return None
    return usage.used * 100.0 / usage.total if usage.total else None


def _db_size_mb():
    if connection.vendor == 'postgresql':
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_database_size(current_database())')
                return float(cursor.fetchone()[0]) / 1024.0 ** 2
        except Exception:
            return None
    name = django_settings.DATABASES['default'].get('NAME') or ''
    try:
        return os.path.getsize(name) / 1024.0 ** 2 if name and os.path.isfile(name) else None
    except OSError:
        return None


def _health(cutoffs, media, now):
    """A part of the platform that is not answering at all, from the same checks
    the dashboard's health strip runs. `slow` and `degraded` are not alerts —
    nobody can fix a slow database by clicking something here.
    """
    checks = stats.health(cutoffs, media=media)['checks']
    down = [item for item in checks if item['state'] == 'down']
    if not down:
        return {}
    names = ', '.join(item['label'].lower() for item in down)
    return {
        'health_down': _raise(
            'health_down', 'health_down',
            f'{names} is not answering',
            down[0]['detail'] + ' Nothing that depends on it can be trusted on this screen until it comes back.',
            '/alerts',
            severity=AdminAlert.Severity.CRITICAL,
            context={'checks': [item['id'] for item in down]},
        ),
    }


def _signup_wave(limit, now):
    """A wave of joins in an hour: what a bot fleet signing up looks like from inside."""
    since = now - timedelta(hours=1)
    rows = User.objects.filter(date_joined__gte=since)
    count = rows.count()
    if count < limit:
        return {}
    fresh = rows.order_by('-date_joined')
    unverified = rows.filter(email_verified=False).count()
    return {
        'signup_wave': _raise(
            'signup_wave', 'signup_wave',
            f'{count} accounts joined in the last hour',
            f'{unverified} of them have not verified their email. Either something is promoting the platform '
            f'tonight or the rate limit at the sign-up door ({settings_store.get("spam_signup_per_hour")} '
            'per address) is being worked around from many addresses.',
            '/people?state=unverified',
            severity=AdminAlert.Severity.CRITICAL if count >= limit * 3 else AdminAlert.Severity.WARNING,
            context={'joined': count, 'unverified': unverified, 'limit': limit,
                     'usernames': [row.username for row in fresh[:5]]},
        ),
    }


def _report_spike(limit, now):
    since = now - timedelta(hours=1)
    count = Report.objects.filter(created_at__gte=since).count()
    if count < limit:
        return {}
    reasons = list(Report.objects.filter(created_at__gte=since).values('reason').annotate(n=Count('pk'))
                  .order_by('-n')[:3])
    top = ', '.join(f'{item["reason"]} ({item["n"]})' for item in reasons)
    return {
        'report_spike': _raise(
            'report_spike', 'report_spike',
            f'{count} reports arrived in an hour',
            f'That is more than the {limit} this desk calls a spike. The reasons they were filed under: {top}. '
            'A coordinated report run pulls content out of the feed on its own.',
            '/reports?status=open',
            severity=AdminAlert.Severity.CRITICAL,
            context={'reports': count, 'limit': limit, 'reasons': reasons},
        ),
    }


def _login_attack(limit, now):
    """Member accounts locked out of sign-in at the same moment.

    The staff version of this is `staff_lockouts`; a member lockout is a different
    trouble — it is somebody's account, and a fleet trying passwords across many
    accounts shows up as many locks at once rather than five guesses on one.
    """
    locked = User.objects.filter(locked_until__gt=now)
    count = locked.count()
    if count < limit:
        return {}
    names = [row.username for row in locked.order_by('-locked_until')[:5]]
    return {
        'login_attack': _raise(
            'login_attack', 'login_attack',
            f'{count} accounts are locked out of sign-in right now',
            f'Too many wrong passwords, all within the same window: {", ".join(names)}'
            f'{" and others" if count > len(names) else ""}. Either one person forgot theirs or one list of '
            'stolen ones is being tried against this platform.',
            '/people?state=locked',
            severity=AdminAlert.Severity.CRITICAL,
            context={'accounts': count, 'limit': limit, 'usernames': names},
        ),
    }


def _coin_rush(requests_limit, coins_limit, now):
    """Unusual coin activity: many people buying at once, or one hour asking for a lot.

    Both directions matter and they are not the same trouble. A hundred small
    requests is a promotion working; ten requests for two thousand coins each is a
    payment proof worth checking twice.
    """
    since = now - timedelta(hours=1)
    hour = CoinRequest.objects.filter(created_at__gte=since)
    count = hour.count()
    coins = sum((row.coins for row in hour), 0)
    if count < requests_limit and coins < coins_limit:
        return {}
    payer = (
        hour.values('user__username').annotate(n=Count('pk'), asked=Sum('coins')).order_by('-asked').first()
    )
    which = []
    if count >= requests_limit:
        which.append(f'{count} people asked for coins in an hour, against {requests_limit}')
    if coins >= coins_limit:
        which.append(f'{coins} coins are being asked for in an hour, against {coins_limit}')
    return {
        'coin_rush': _raise(
            'coin_rush', 'coin_rush',
            'Coin requests are out of the ordinary this hour',
            '; '.join(which) + (f'. The largest single payer is @{payer["user__username"]} with '
                                f'{payer["asked"]} coins.' if payer else ''),
            '/coins?status=pending',
            severity=AdminAlert.Severity.CRITICAL if coins >= coins_limit else AdminAlert.Severity.WARNING,
            context={'requests': count, 'coins': coins, 'top': payer},
        ),
    }


def _pulses(now):
    """Everything that happens outside these tables, as far as it has reported."""
    found = {}
    for key, spec in PULSES.items():
        row = AdminPulse.objects.filter(key=key).first()
        kind = key
        if row is None:
            found[f'{kind}:silent'] = _raise(
                f'{kind}:silent', kind,
                f'Nothing reports {spec["label"].lower()} to this console',
                spec['silent'], spec['href'],
                severity=AdminAlert.Severity.INFO, context={'pulse': key},
            )
            continue
        if row.state == AdminPulse.State.FAIL:
            found[f'{kind}:failing'] = _raise(
                f'{kind}:failing', kind,
                f'{spec["label"]} reports trouble',
                (row.detail or 'The reporter said it failed and gave no reason.')
                + f' Last reported {row.stamped_at:%Y-%m-%d %H:%M} UTC.',
                spec['href'], severity=spec['severity'],
                context={'pulse': key, 'state': row.state, 'detail': row.detail, 'counts': row.counts},
            )
            continue
        counted = spec.get('counted')
        at = settings_store.get(spec['at']) if spec.get('at') else None
        waiting = int(row.counts.get(counted, 0) or 0) if counted else 0
        if counted and at is not None and waiting >= float(at):
            found[f'{kind}:backlog'] = _raise(
                f'{kind}:backlog', kind,
                f'{spec["label"].lower()}: {waiting} waiting',
                f'The {spec["label"].lower()} reporter says {waiting} are waiting, past the '
                f'{int(at)} this desk calls a backlog. {row.detail}'.strip(),
                spec['href'], severity=spec['severity'],
                context={'pulse': key, 'counted': counted, 'waiting': waiting, 'limit': at},
            )
            continue
        window = settings_store.get(spec['stale']) if spec.get('stale') else None
        if window is None:
            continue
        unit = 'hours' if spec.get('hours') else 'minutes'
        age = _minutes_since(row.stamped_at, now)
        stale = age / 60.0 if spec.get('hours') else float(age)
        if stale >= float(window):
            found[f'{kind}:stale'] = _raise(
                f'{kind}:stale', kind,
                f'No word about {spec["label"].lower()} for {round(stale)} {unit}',
                f'The last report said “{row.detail or row.get_state_display()}” at '
                f'{row.stamped_at:%Y-%m-%d %H:%M} UTC, and this desk gives up after {window} {unit}. '
                'A job that has stopped reporting and a job that finished quietly look the same from here.',
                spec['href'], severity=spec['severity'],
                context={'pulse': key, 'age_minutes': age, 'limit': float(window), 'unit': unit},
            )
    return found


def scan(now=None, media=None):
    """Every condition, once, against the thresholds as they stand right now."""
    now = now or timezone.now()
    thresholds = settings_store.values()
    media = media if media is not None else storage_used()
    cutoffs = stats.windows(now)

    found = {}
    found.update(_report_piles(spam.report_threshold(), now))
    found.update(_ageing_reports(thresholds['alert_report_age_hours'], now))
    found.update(_ageing_coin_queue(thresholds['alert_coin_queue_hours'], now))
    found.update(_autohide_wave(thresholds['alert_autohide_day'], now))
    found.update(_staff_lockouts(thresholds['alert_staff_lockouts'], now))
    found.update(_storage(media, thresholds['alert_storage_gb'], now))
    found.update(_report_spike(thresholds['alert_report_spike'], now))
    found.update(_signup_wave(thresholds['alert_signup_wave'], now))
    found.update(_login_attack(thresholds['alert_login_locks'], now))
    found.update(_coin_rush(thresholds['alert_coin_spike'], thresholds['alert_coin_coins_hour'], now))
    found.update(_server(now))
    found.update(_health(cutoffs, media, now))
    found.update(_pulses(now))

    _close(set(found))
    return list(found.values())


def line(item):
    return {
        'id': item.pk,
        'key': item.key,
        'kind': item.kind,
        'severity': item.severity,
        'status': item.status,
        'title': item.title,
        'detail': item.detail,
        'href': item.href,
        'context': item.context,
        'occurrences': item.occurrences,
        'first_seen': item.first_seen,
        'last_seen': item.last_seen,
        'resolved_at': item.resolved_at,
        'acked_by': item.acked_by.username if item.acked_by else None,
    }


# What a warning list leads with: a trouble that is still true, and the worst of
# those first. Both `status` and `severity` are text, so the order a seat reads them
# in has to be said here — by the alphabet `acked` sorts ahead of `open` and `info`
# ahead of `critical`, which is the opposite of a queue.
OPEN_FIRST = Case(
    When(status=AdminAlert.Status.OPEN, then=Value(0)),
    When(status=AdminAlert.Status.ACKED, then=Value(1)),
    default=Value(2),
    output_field=IntegerField(),
)
WORST_FIRST = Case(
    When(severity=AdminAlert.Severity.CRITICAL, then=Value(0)),
    When(severity=AdminAlert.Severity.WARNING, then=Value(1)),
    default=Value(2),
    output_field=IntegerField(),
)


def _ordered(rows):
    return rows.order_by(OPEN_FIRST, WORST_FIRST, '-last_seen', 'pk')


def feed(limit=12, offset=0):
    """What the dashboard shows: still-true trouble first, worst of it first.

    `offset` is the panel's Load more: seven rows arrive with the tiles and the
    rest of the trail comes one page at a time, in the same order, so a row from
    page two cannot jump above one the seat has already read.
    """
    return [line(item) for item in _ordered(AdminAlert.objects.select_related('acked_by'))[offset:offset + limit]]


def history(status='', kind='', severity='', limit=100):
    """The full trail, not the twelve newest: the contract asks what has ever fired.

    Still-true conditions come first and then by recency, because a seat reading
    this at 9am wants the thing that is still happening above the things that
    stopped being true.
    """
    rows = AdminAlert.objects.select_related('acked_by')
    status = (status or 'all').strip()
    if status in (AdminAlert.Status.OPEN, AdminAlert.Status.ACKED):
        rows = rows.filter(status=status)
    elif status == 'active':
        rows = rows.filter(status__in=(AdminAlert.Status.OPEN, AdminAlert.Status.ACKED))
    elif status == 'resolved':
        rows = rows.filter(status=AdminAlert.Status.RESOLVED)
    elif status not in ('', 'all'):
        raise ValueError('Choose active, open, acknowledged, resolved or all.')
    if kind:
        rows = rows.filter(kind=kind)
    if severity:
        rows = rows.filter(severity=severity)
    rows = _ordered(rows)[:limit]
    return [line(item) for item in rows]


def kinds():
    """What has ever fired, by condition — the filter list for the history screen."""
    return [
        {'kind': item['kind'], 'n': item['n'],
         'active': item['active'], 'resolved': item['resolved']}
        for item in AdminAlert.objects.values('kind').annotate(
            n=Count('pk'),
            active=Count('pk', filter=Q(status__in=(AdminAlert.Status.OPEN, AdminAlert.Status.ACKED))),
            resolved=Count('pk', filter=Q(status=AdminAlert.Status.RESOLVED)),
        ).order_by('kind')
    ]


def threshold_lines():
    """The dials this desk turns, each with who last turned it and when.

    `alert_coin_queue_hours` sits in the payments group and the other seventeen in
    safety, so the list is built from the keys the checks actually read rather than
    from whichever group the screen was named after.
    """
    return settings_store.lines(keys=THRESHOLDS)


def pulses():
    """Each outside reporter: whether it has ever been heard from, and what it last said.

    A screen that only lists alerts shows a wire nobody connected as nothing at all.
    Listing the wire itself is what makes "the backup job has never reported here"
    something a seat can act on — with the exact command that would start it.
    """
    out = []
    for key, spec in PULSES.items():
        row = AdminPulse.objects.filter(key=key).first()
        out.append({
            'key': key,
            'label': spec['label'],
            'severity': spec['severity'],
            'href': spec['href'],
            'wired': row is not None,
            'state': row.state if row else 'never',
            'detail': row.detail if row else '',
            'counts': row.counts if row else {},
            'stamped_at': row.stamped_at if row else None,
            'stamps': row.stamps if row else 0,
            'quiet_after': settings_store.get(spec['stale']) if spec.get('stale') else None,
            'quiet_unit': 'hours' if spec.get('hours') else 'minutes',
            'counted': spec.get('counted'),
            'counted_at': settings_store.get(spec['at']) if spec.get('at') else None,
            'command': f'python manage.py adminpulse {key} --state=ok --detail="what it saw"',
            'silent': spec['silent'],
        })
    return out


def scan_now(actor, media=None):
    """Re-run every check because a person clicked, and put that on the record.

    The scan writes rows, so a seat who pressed the button is the reason the
    history changed — which is the kind of thing an audit log is for, even when the
    only thing it proves is that nobody ignored a warning on purpose.
    """
    raised = scan(media=media)
    if raised:
        names = ', '.join(item.kind for item in raised[:6])
        detail = (f'{len(raised)} condition(s) true: {names}'
                  + ('…' if len(raised) > 6 else '') + '.')
    else:
        detail = 'Nothing is triggering an alert right now.'
    record(actor, 'alert_scan', 'automated alerts', detail)
    return {
        'detail': detail,
        'raised': [line(item) for item in raised],
        'counts': counts(),
        'feed': feed(20),
    }


def mark(alert_pk, actor, to):
    """Acknowledge or resolve one alert, in the words the seat will read back.

    Resolving by hand is not the same as the condition going away: `scan()` will
    raise the row again the moment it is true, and the screen says so rather than
    pretending a click fixed a disk.
    """
    item = AdminAlert.objects.filter(pk=alert_pk).first()
    if item is None:
        return 404, {'detail': 'No alert with that id.'}
    now = timezone.now()
    if to == 'ack':
        item.status = AdminAlert.Status.ACKED
        item.acked_by = actor
        item.save(update_fields=['status', 'acked_by'])
        detail = f'Acknowledged by {actor.username}. Still true until the next scan says otherwise.'
    elif to == 'resolve':
        item.status = AdminAlert.Status.RESOLVED
        item.acked_by = actor
        item.resolved_at = now
        item.save(update_fields=['status', 'acked_by', 'resolved_at'])
        detail = f'Resolved by {actor.username}. It comes back on its own if the condition is still true.'
    else:
        return 400, {'detail': 'Choose acknowledge or resolve.'}
    record(actor, f'alert_{to}', item.key, item.title)
    return 200, {'detail': detail, 'alert': line(item)}


def write_thresholds(actor, posted):
    """Move the alert dials. Same guard as the spam desk: a number that will not
    parse is refused in words, never written as a stray `abc` a screen then has to
    render.
    """
    cached = settings_store.cached()
    updates, bad = {}, []
    for key, value in (posted or {}).items():
        if key not in THRESHOLDS:
            continue
        spec = cached[key]
        if str(value).strip() == '':
            updates[key] = ''
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            bad.append(f'{spec["label"]} has to be a number.')
            continue
        if number < 0:
            bad.append(f'{spec["label"]} cannot be negative.')
            continue
        if number > 100000:
            bad.append(f'{spec["label"]} is far past any number this desk means.')
            continue
        updates[key] = str(int(number)) if spec['type'] == 'int' else str(number)
    if bad:
        return 400, {'errors': bad, 'detail': ' '.join(bad)}
    if not updates:
        return 400, {'detail': 'Nothing to save — no threshold has been moved.'}
    settings_store.write(actor, updates)
    labels = [cached[key]['label'] for key in updates]
    record(actor, 'alert_thresholds', 'alert thresholds',
           'Changed ' + ', '.join(label.lower() for label in labels) + '.')
    return 200, {
        'detail': 'Saved ' + ', '.join(label.lower() for label in labels)
                  + '. The next scan reads them, and a dial moved high enough closes whatever '
                  'it no longer believes — that is on the record, not a disappearance.',
        'changed': list(updates),
    }



def counts():
    """How much is open, and how much of it is a fire rather than a wire to run.

    The four outside reporters raise an INFO row each until somebody wires them in
    (see `PULSES`). Counting those with the trouble a seat can act on would make a
    fresh install open with four alarms and no fire, so the two numbers are apart.
    """
    by = AdminAlert.objects.values('status').annotate(n=Count('pk'))
    out = {row['status']: row['n'] for row in by}
    live = AdminAlert.objects.filter(status__in=(AdminAlert.Status.OPEN, AdminAlert.Status.ACKED))
    unwired = live.filter(severity=AdminAlert.Severity.INFO).count()
    return {
        'open': out.get(AdminAlert.Status.OPEN, 0),
        'acked': out.get(AdminAlert.Status.ACKED, 0),
        'resolved': out.get(AdminAlert.Status.RESOLVED, 0),
        'attention': live.count() - unwired,
        'unwired': unwired,
    }
