import asyncio
import json
import time

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Q
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.api import person
from apps.common.pagination import KeysetPagination
from apps.common.stream import acquire, release, stream_user
from apps.messages.models import Message

from .models import Notification

class NotificationSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source='actor.username', read_only=True)
    # The inbox is always the reader's own, but a row that names its recipient is
    # one the client can file under the right person without assuming anything.
    recipient = serializers.IntegerField(source='recipient_id', read_only=True)
    # One card so the whole page renders names and avatars without a second request.
    actor_card = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ['id', 'recipient', 'actor', 'actor_username', 'actor_card', 'kind', 'target_type', 'target_id', 'text', 'read_at', 'created_at']

    def get_actor_card(self, obj):
        return person(obj.actor)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_list(request):
    qs = Notification.objects.filter(recipient=request.user).select_related('actor__profile')
    if request.query_params.get('unread'):
        qs = qs.filter(read_at__isnull=True)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(NotificationSerializer(rows, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def unread_count(request):
    """Both badge counters, for a screen that only needs to know they changed."""
    return Response({
        'unread': Notification.objects.filter(recipient=request.user, read_at__isnull=True).count(),
        'messages': Message.objects.filter(
            read_at__isnull=True, conversation__participants=request.user
        ).exclude(sender=request.user).count(),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_read(request):
    qs = Notification.objects.filter(recipient=request.user, read_at__isnull=True)
    ids = request.data.get('ids')
    if ids:
        qs = qs.filter(pk__in=ids)
    count = qs.update(read_at=timezone.now())
    return Response({'read': count})


def _since(user_pk, since_ts, since_pk, limit=50):
    """Rows born after the cursor, oldest first. Re-stamped rows (a repeat
    message from the same actor) carry a new created_at, so the cursor sees
    them again even though their pk never moves."""
    qs = Notification.objects.filter(recipient_id=user_pk).select_related('actor__profile')
    if since_ts is None:
        # No cursor means a first connect: the list page already holds the
        # past, so the stream only carries what happens from here.
        qs = qs.filter(created_at__gt=timezone.now())
    else:
        qs = qs.filter(Q(created_at__gt=since_ts) | Q(created_at=since_ts, pk__gt=since_pk))
    rows = []
    for row in qs.order_by('created_at', 'pk')[:limit]:
        rows.append({
            'event_id': f'{row.created_at.isoformat()}|{row.pk}',
            'created_at': row.created_at,
            'pk': row.pk,
            'data': NotificationSerializer(row).data,
        })
    return rows


async def _notification_events(user_pk, since_ts, interval, max_life, since_pk=0):
    deadline = time.monotonic() + max_life
    # A stream opened without a cursor starts from "now" — everything earlier
    # is already on the page from the mount fetch. The baseline is captured
    # once here: re-reading timezone.now() per poll would move the goalposts
    # and every row created before a poll would silently never be delivered.
    if since_ts is None:
        since_ts = timezone.now()
    try:
        yield 'retry: 4000\n\n'
        while time.monotonic() < deadline:
            await asyncio.sleep(interval)
            rows = await sync_to_async(_since)(user_pk, since_ts, since_pk)
            for row in rows:
                since_ts, since_pk = row['created_at'], row['pk']
                payload = json.dumps(row['data'], cls=DjangoJSONEncoder, separators=(',', ':'))
                yield f"event: notification\nid: {row['event_id']}\ndata: {payload}\n\n"
            if not rows:
                yield ': keepalive\n\n'
    finally:
        release(user_pk)


async def notification_stream(request):
    user = await sync_to_async(stream_user)(request)
    if user is None:
        return JsonResponse({'detail': 'Authentication required.'}, status=401)
    if user.is_suspended:
        return JsonResponse({'detail': 'Account suspended.'}, status=403)

    raw = request.headers.get('Last-Event-ID') or request.GET.get('last_event_id') or ''
    since_ts, since_pk = None, 0
    if raw and '|' in raw:
        iso, _, pk = raw.rpartition('|')
        parsed = parse_datetime(iso)
        # A cursor we cannot read falls back to first-connect semantics rather
        # than an error: the client refetches the list page either way.
        if parsed:
            since_ts = parsed
            try:
                since_pk = int(pk)
            except ValueError:
                since_ts = None

    if not acquire(user.pk, settings.SSE_STREAMS_PER_USER):
        return JsonResponse({'detail': 'Too many live streams for this account. Close a tab and try again.'}, status=429)

    response = StreamingHttpResponse(
        _notification_events(user.pk, since_ts, settings.SSE_INTERVAL, settings.SSE_MAX_LIFE, since_pk),
        content_type='text/event-stream',
    )
    response['Cache-Control'] = 'no-cache, no-transform'
    response['X-Accel-Buffering'] = 'no'
    # no-transform is load-bearing: Next's proxy (and any compression layer in
    # front of us) reads this header and skips gzipping the stream. A gzipped
    # event-stream stays open but its frames never parse in the browser.
    return response