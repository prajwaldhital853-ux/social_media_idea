"""The dashboard reads: one call for the numbers on the fold, one for campaign results.

Kept as two endpoints because campaign performance costs a handful of queries per
promotion — the tiles would otherwise wait on a table the person can scroll past,
and the second call fills in under the first paint.
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import alerts, rbac, settings_store, stats


def _int(request, name, fallback, low, high):
    """A query parameter that cannot be talked into scanning the whole platform."""
    try:
        return max(low, min(high, int(request.query_params.get(name) or fallback)))
    except ValueError:
        return fallback


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('overview')
def admin_overview(request):
    """New accounts, posts, comments, listings, queues, coins, storage, health, alerts.

    `refresh=1` re-walks the upload directory instead of taking the five-minute
    cached figure, which is what the Reload button on the screen does.
    """
    media = stats.storage_used(refresh=request.query_params.get('refresh') in ('1', 'true'))
    cutoffs = stats.windows()
    alerts.scan(cutoffs['now'], media=media)
    return Response({
        'generated_at': cutoffs['now'],
        'windows': {
            'today': cutoffs['today'],
            'week': cutoffs['week'],
            'month': cutoffs['month'],
            'series_days': stats.SERIES_DAYS,
        },
        'tiles': stats.tiles(cutoffs, media=media),
        'health': stats.health(cutoffs, media=media),
        'alerts': {'counts': alerts.counts(), 'recent': alerts.feed(10)},
        'thresholds': settings_store.cached(),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('overview')
def admin_promotion_analytics(request):
    """Views, opens, reactions, comments, saves, followers and coins per campaign.

    The two metrics with no event behind them come back as `unmeasured` sentences
    rather than zeros, so the screen says what is not known instead of implying a
    campaign achieved nothing.
    """
    cutoffs = stats.windows()
    limit = _int(request, 'limit', 12, 1, 40)
    rows = stats.promotion_performance(cutoffs, limit=limit)
    return Response({
        'generated_at': cutoffs['now'],
        'metrics': [{'id': key, 'label': label} for key, label in stats.METRIC_LABELS],
        'unmeasured': dict(stats.UNMEASURED),
        'rows': rows,
        'totals': stats.performance_totals(rows),
        'shown': len(rows),
    })
