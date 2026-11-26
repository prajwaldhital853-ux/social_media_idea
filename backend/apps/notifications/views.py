import asyncio
import json
import time

from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer
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

from apps.accounts.models import User
from apps.adminpanel.models import PublicNotice
from apps.comments.models import Comment
from apps.common.api import person
from apps.common.pagination import KeysetPagination
from apps.common.stream import acquire, release, stream_user
from apps.marketplace.models import Listing
from apps.messages.models import Message
from apps.posts.models import Post

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
        fields = ['id', 'recipient', 'actor', 'actor_username', 'actor_card', 'kind', 'target_type', 'target_id', 'text', 'read_at', 'created_at', 'notice']

    def get_actor_card(self, obj):
        return person(obj.actor)


def warning_target(kind, target_id):
    if not str(target_id or '').isdigit():
        return None
    pk = int(target_id)
    if kind == 'post':
        row = Post.objects.filter(pk=pk).select_related('author').first()
        if row is None:
            return None
        return {
            'kind': kind, 'id': row.pk, 'status': row.status,
            'created_at': row.created_at, 'text': row.text[:600],
            'author': person(row.author), 'href': f'/post/{row.pk}',
        }
    if kind == 'comment':
        row = Comment.objects.filter(pk=pk).select_related('author', 'post').first()
        if row is None:
            return None
        return {
            'kind': kind, 'id': row.pk, 'status': row.status,
            'created_at': row.created_at, 'text': row.text[:600],
            'author': person(row.author), 'href': f'/post/{row.post_id}#comment-{row.pk}',
        }
    if kind == 'listing':
        row = Listing.objects.filter(pk=pk).select_related('seller').first()
        if row is None:
            return None
        return {
            'kind': kind, 'id': row.pk, 'status': row.status,
            'created_at': row.created_at, 'text': (f'{row.title}\n{row.description}')[:600],
            'author': person(row.seller), 'href': f'/marketplace/{row.pk}',
        }
    if kind == 'user':
        row = User.objects.filter(pk=pk).first()
        if row is None:
            return None
        return {
            'kind': kind, 'id': row.pk, 'status': 'suspended' if row.is_suspended else 'active' if row.is_active else 'deactivated',
            'created_at': row.date_joined, 'text': '', 'author': person(row),
            'href': f'/u/{row.username}',
        }
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_detail(request, pk):
    row = Notification.objects.select_related(
        'recipient', 'actor', 'actor__profile',
        'notice', 'notice__actor', 'notice__actor__profile',
        'notice__about', 'notice__about__profile',
    ).filter(pk=pk, recipient=request.user).first()
    if row is None:
        return Response({'detail': 'No such notification.'}, status=404)
    data = NotificationSerializer(row).data
    notice = row.notice
    notice_data = None
    if notice is not None:
        if notice.audience == PublicNotice.Audience.PRIVATE and notice.about_id != request.user.pk:
            return Response({'detail': 'No such notification.'}, status=404)
        notice_data = {
            'id': notice.pk, 'text': notice.text, 'reason': notice.reason,
            'audience': notice.audience, 'created_at': notice.created_at,
            'is_live': notice.is_live, 'withdrawn_at': notice.withdrawn_at,
            'by': notice.actor.username if notice.actor else None,
            'actor_card': person(notice.actor), 'about': person(notice.about),
        }
    kind = notice.target_type if notice is not None else row.target_type
    target_id = notice.target_id if notice is not None else row.target_id
    data.update({
        'notice_detail': notice_data,
        'target': warning_target(kind, target_id),
    })
    if row.read_at is None:
        Notification.objects.filter(pk=row.pk, recipient=request.user).update(read_at=timezone.now())
        row.read_at = timezone.now()
        data['read_at'] = row.read_at
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_list(request):
    qs = Notification.objects.filter(recipient=request.user).select_related('actor__profile', 'notice')
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
    # Pulse frames (reaction tallies, balances, decisions, new posts) ring the
    # same connection as a doorbell instead of waiting for the tick. A pump
    # drains the channel into a queue so a frame that lands during a slow tick
    # is never dropped; the tick below stays exactly the beat it always was.
    layer = get_channel_layer()
    channel = await layer.new_channel('pulse.')
    user_group = f'user.{user_pk}'
    await layer.group_add(user_group, channel)
    await layer.group_add('site', channel)
    frames: asyncio.Queue = asyncio.Queue()

    async def pump():
        while True:
            try:
                message = await layer.receive(channel)
            except asyncio.CancelledError:
                return
            except Exception:  # noqa: BLE001 - a layer folding under us ends the stream anyway
                return
            if isinstance(message, dict) and message.get('frame'):
                frames.put_nowait(message['frame'])

    drainer = asyncio.ensure_future(pump())
    try:
        yield 'retry: 4000\n\n'
        while time.monotonic() < deadline:
            landed = []
            try:
                landed.append(await asyncio.wait_for(frames.get(), timeout=interval))
                while not frames.empty():
                    landed.append(frames.get_nowait())
            except asyncio.TimeoutError:
                pass
            for frame in landed:
                yield f'event: pulse\ndata: {frame}\n\n'
            rows = await sync_to_async(_since)(user_pk, since_ts, since_pk)
            for row in rows:
                since_ts, since_pk = row['created_at'], row['pk']
                payload = json.dumps(row['data'], cls=DjangoJSONEncoder, separators=(',', ':'))
                yield f"event: notification\nid: {row['event_id']}\ndata: {payload}\n\n"
            if not rows and not landed:
                yield ': keepalive\n\n'
    finally:
        release(user_pk)
        drainer.cancel()
        for group in (user_group, 'site'):
            try:
                await layer.group_discard(group, channel)
            except Exception:  # noqa: BLE001 - a loop already on its way out cannot be argued with
                pass


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