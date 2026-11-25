"""Contract 6.9: the audit log screen, and the facets a Client asks it with.

The log is append-only and belongs to the moderation app; this door only reads it.
What it adds is the shape of the question, *who* did *what* *when*, and the reason
that was typed with it, so a seat asked in March what changed in January can answer
without a database client.

The facets come back with every page on purpose. `families()` carries the families
that have never been used as `n: 0` rows, because "coin approvals are not logged" and
"there were no coin approvals this month" look identical in an empty filter list, and
the difference is exactly what somebody auditing the platform is trying to find out.
"""

from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.pagination import KeysetPagination

from . import audit, rbac

PAGE = 40
BAD_DATE = 'Give a date as 2026-11-22, or a full time as 2026-11-22 14:00.'


def _moment(raw, end=False):
    """`2026-11-22` and a full timestamp both mean the same thing here.

    A date with no clock on it is read as the whole day, so the upper bound lands on
    its last second, a range that quietly drops the day it names is a range nobody
    can reconcile against anything. `parse_datetime` accepts a bare date and puts it
    at midnight, so the day-only shape is split off before it ever sees one.
    """
    text = str(raw or '').strip()
    if not text:
        return None, None
    if ':' not in text and len(text) <= 10:
        day = parse_date(text)
        if day is None:
            return None, BAD_DATE
        return timezone.make_aware(
            datetime.combine(day, datetime.max.time() if end else datetime.min.time())
        ), None
    stamp = parse_datetime(text)
    if stamp is None:
        return None, BAD_DATE
    if timezone.is_naive(stamp):
        stamp = timezone.make_aware(stamp)
    return stamp, None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('audit')
def audit_trail(request):
    """Every staff action, newest first, with who, why, and what was typed with it."""
    params = request.query_params
    since, bad = _moment(params.get('since'))
    if bad:
        return Response({'detail': bad}, status=400)
    until, bad = _moment(params.get('until'), end=True)
    if bad:
        return Response({'detail': bad}, status=400)
    rows = audit.queryset(
        actor=params.get('actor') or '',
        family=params.get('family') or '',
        action=params.get('action') or '',
        q=params.get('q') or '',
        since=since,
        until=until,
    )
    paginator = KeysetPagination()
    paginator.page_size = PAGE
    page = paginator.paginate_queryset(rows, request)
    response = paginator.get_paginated_response([audit.line(item) for item in page])
    response.data.update({
        'generated_at': timezone.now(),
        'facets': {'families': audit.families(), 'actors': audit.actors(), 'actions': audit.actions()},
        'summary': audit.summary(rows),
        'whole': audit.summary(),
        'filters': {
            'actor': params.get('actor') or '', 'family': params.get('family') or '',
            'action': params.get('action') or '', 'q': params.get('q') or '',
            'since': params.get('since') or '', 'until': params.get('until') or '',
        },
        'contract': list(audit.CONTRACT_FAMILIES),
    })
    return response
