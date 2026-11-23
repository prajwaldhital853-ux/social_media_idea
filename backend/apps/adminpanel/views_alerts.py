"""Contract 6.9: the alert desk — what has ever fired, what would stop it, what watches nothing.

Four doors, and the split between them is the split a seat works in. The list is
read-only and answers the question "what is true right now and what was true last
month"; the scan is the one button that writes, because a screen showing a problem
the checks no longer believe is worse than no screen; the thresholds are the dials
that decide when something becomes a problem; and `pulses` is the honest half —
four conditions the contract names that nothing outside this codebase reports on
yet, listed as wires rather than as numbers.

Nothing here fires on a GET. `admin/overview` already runs `scan()` as part of
painting the dashboard, so a second scan on every read of this screen would double
the queries and rewrite `occurrences` twice per page load.
"""

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import alerts, rbac, stats
from .models import AdminAlert

STATUSES = [{'id': item, 'label': label} for item, label in AdminAlert.Status.choices]
SEVERITIES = [{'id': item, 'label': label} for item, label in AdminAlert.Severity.choices]
KIND_LABELS = {
    'report_pile': 'One post, many reporters',
    'report_ageing': 'Reports gone unanswered',
    'coin_queue_ageing': 'Payment proofs waiting',
    'autohide_wave': 'A day of automatic hides',
    'staff_lockouts': 'Staff seats locked out',
    'storage_high': 'Uploads out of space',
    'report_spike': 'A spike of reports',
    'signup_wave': 'A wave of new accounts',
    'login_attack': 'Accounts locked at once',
    'coin_rush': 'Unusual coin activity',
    'disk_high': 'The volume is full',
    'db_large': 'The database has grown',
    'health_down': 'A part of the platform is not answering',
    'web': 'The public site',
    'backup': 'Backups',
    'errors': 'App errors',
    'jobs': 'Media processing',
}


def _limit(request):
    """A page of history the desk will actually walk, never the whole table at once."""
    try:
        return max(1, min(500, int(request.query_params.get('limit') or 100)))
    except ValueError:
        return 100


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('alerts')
def alert_desk(request):
    """The trail of every automated alert, the dials behind it, and the silent wires."""
    params = request.query_params
    try:
        rows = alerts.history(
            status=params.get('status') or '',
            kind=params.get('kind') or '',
            severity=params.get('severity') or '',
            limit=_limit(request),
        )
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=400)
    return Response({
        'generated_at': timezone.now(),
        'counts': alerts.counts(),
        'rows': rows,
        'kinds': [
            {**item, 'label': KIND_LABELS.get(item['kind'], item['kind'].replace('_', ' '))}
            for item in alerts.kinds()
        ],
        'thresholds': alerts.threshold_lines(),
        'pulses': alerts.pulses(),
        'statuses': STATUSES,
        'severities': SEVERITIES,
        'shown': len(rows),
        'health': stats.health(stats.windows(), media=None),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('alerts')
def alert_scan(request):
    """Run every check again, now, on somebody's request."""
    out = alerts.scan_now(
        request.user,
        media=stats.storage_used(refresh=request.query_params.get('refresh') in ('1', 'true')),
    )
    return Response(out)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('alerts')
def alert_thresholds(request):
    """Move the dials. The next scan uses them; nothing already raised is silenced."""
    code, body = alerts.write_thresholds(request.user, request.data)
    return Response(body, status=code)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('alerts')
def alert_mark(request, pk):
    """Acknowledge or resolve one alert, and say what that click did not do."""
    to = str(request.data.get('to') or request.data.get('action') or 'ack')
    code, body = alerts.mark(pk, request.user, to)
    return Response(body, status=code)
