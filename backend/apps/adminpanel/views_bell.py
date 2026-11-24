"""The staff bell: one unread-count door and one door that clears notices.

Two doors, no more, because the tray is small and the console polls it. `bell_desk`
answers for any seat at all — which notices a seat is told about is decided by the
permission each row was written against, so the door does not need a key of its own.
Marking read is a write, and the only thing it writes is `read_at`: it never deletes,
because "did anyone see this" is a question a seat asks about themselves, not about
the trail.
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import bell, rbac


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only()
def bell_desk(request):
    """What is waiting, and how much of it waits on each screen."""
    return Response(bell.tray(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only()
def bell_read(request):
    """Close one notice, every notice under a route, or the whole tray."""
    data = request.data or {}
    status_code, body = bell.mark(
        request.user,
        notice_id=data.get('id'),
        route=data.get('route') or '',
        all_read=bool(data.get('all')),
    )
    return Response(body, status=status_code)
