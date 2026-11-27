"""The dashboard reads: one call for the numbers on the fold, one for campaign results.

Kept as two endpoints because campaign performance costs a handful of queries per
promotion, the tiles would otherwise wait on a table the person can scroll past,
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


# Both dashboard panels stop here and offer the rest behind a click, because the
# tiles are the reason the screen is opened and a long trail should not push them
# off the top or stretch the page past the seat it is read from.
PAGE = 7


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
    tally = alerts.counts()
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
        'alerts': {
            'counts': tally,
            'recent': alerts.feed(PAGE),
            'total': tally['open'] + tally['acked'] + tally['resolved'],
        },
        'thresholds': settings_store.cached(),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('overview')
def admin_alert_feed(request):
    """The next page of the dashboard's alerts panel, in the panel's own order."""
    limit = _int(request, 'limit', PAGE, 1, 40)
    offset = _int(request, 'offset', 0, 0, 5000)
    tally = alerts.counts()
    return Response({
        'rows': alerts.feed(limit, offset),
        'total': tally['open'] + tally['acked'] + tally['resolved'],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('overview')
def admin_promotion_analytics(request):
    """Views, opens, reactions, comments, saves, followers, messages and coins per campaign.

    A metric with no events behind it still comes back as an `unmeasured` sentence
    rather than a zero, so the screen says what is not known instead of implying a
    campaign achieved nothing. Nothing on the table is unmeasured any more.

    `limit` and `offset` page the table, because scoring a campaign costs a
    handful of queries and a platform with three hundred promotions should not
    answer a dashboard that shows seven of them by running three hundred.
    """
    cutoffs = stats.windows()
    limit = _int(request, 'limit', PAGE, 1, 40)
    offset = _int(request, 'offset', 0, 0, 5000)
    rows = stats.promotion_performance(cutoffs, limit=limit, offset=offset)
    return Response({
        'generated_at': cutoffs['now'],
        'metrics': [{'id': key, 'label': label} for key, label in stats.METRIC_LABELS],
        'unmeasured': dict(stats.UNMEASURED),
        'rows': rows,
        'totals': stats.performance_totals(rows),
        'shown': len(rows),
        'offset': offset,
        'total': stats.promotion_count(),
    })
