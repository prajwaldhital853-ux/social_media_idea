"""The thread's live line, for the hops a WebSocket cannot survive.

The socket next door is the better wire when a proxy carries the upgrade: a
message arrives the moment it is written. Plenty of hosts do not. A serverless
edge in front of the app flattens the handshake into an ordinary GET, the socket
never opens, and the thread falls back to waiting for its next poll — which is
what "the messages are slow" means when everything else looks healthy.

Server-Sent Events ride the same proxy as an ordinary response, so the thread
reads its own rows from here. One query a second per open thread, one connection
per open thread, and a client that keeps the slower poll only while this is down.
"""

import asyncio
import json
import time
from datetime import timedelta

from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Max, Q
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.accounts.models import User
from apps.common.stream import acquire, release, stream_user

from .models import Message
from .presence import mark_watching, stop_watching, typing_beat
from .views import MessageSerializer

# A thread opens with its own page fetch a moment earlier; starting exactly at
# "now" would drop a message written inside that gap. The cache merges by id, so
# replaying a row the client already holds costs nothing and losing one does not.
BACKFILL = timedelta(seconds=10)


def _messages(user, other, since_ts, since_pk, limit=50):
    """Rows of this pair's thread newer than the cursor, oldest first."""
    return list(
        Message.objects.filter(conversation__participants=user)
        .filter(conversation__participants=other)
        .filter(Q(created_at__gt=since_ts) | Q(created_at=since_ts, pk__gt=since_pk))
        .select_related('sender')
        .order_by('created_at', 'pk')[:limit]
    )


def _receipts(user, other):
    """How far the reader has taken my own messages: reached them, seen them."""
    mine = Message.objects.filter(
        conversation__participants=user, sender=user,
    ).filter(conversation__participants=other)
    row = mine.aggregate(reached=Max('delivered_at'), seen=Max('read_at'))
    return row['reached'], row['seen']


def _tick(user, other, since_ts, since_pk, reached, seen, typed_at):
    """One look at the thread: the rows, receipts and typing beat to ship now."""
    events = []
    for message in _messages(user, other, since_ts, since_pk):
        since_ts, since_pk = message.created_at, message.pk
        events.append(('chat', {
            'event_id': f'{message.created_at.isoformat()}|{message.pk}',
            'message': MessageSerializer(message).data,
        }))
    my_reached, my_seen = _receipts(user, other)
    # A jump from sent straight to seen is one tick with both stamps already on
    # the row; the stronger receipt is the only one worth telling the client.
    if my_seen and (not seen or my_seen > seen):
        events.append(('receipt', {'state': 'read', 'at': my_seen}))
    elif my_reached and (not reached or my_reached > reached):
        events.append(('receipt', {'state': 'delivered', 'at': my_reached}))
    beat = typing_beat(other.pk, user.pk)
    if beat and (not typed_at or beat > typed_at):
        typed_at = beat
        events.append(('typing', {'by': other.username}))
    return events, since_ts, since_pk, my_reached or reached, my_seen or seen, typed_at


async def _thread_events(user, other, since_ts, since_pk, interval, max_life):
    deadline = time.monotonic() + max_life
    reached = seen = typed_at = None
    # The socket's group is also this stream's doorbell: whoever writes a row
    # rings it, and the tick that follows reads the database, not the frame. So
    # a message arrives as fast as the send that wrote it, and the interval is
    # only the beat that catches what no one announced.
    layer = get_channel_layer()
    lo, hi = sorted((user.pk, other.pk))
    group = f'chat.{lo}.{hi}'
    channel = await layer.new_channel('thread.')
    try:
        yield 'retry: 3000\n\n'
        await layer.group_add(group, channel)
        while time.monotonic() < deadline:
            try:
                await asyncio.wait_for(layer.receive(channel), timeout=interval)
            except asyncio.TimeoutError:
                pass
            # The proof of life is the loop itself: whoever holds a stream holds
            # the thread, and the flag lapses the moment this generator ends.
            mark_watching(user.pk, other.pk)
            events, since_ts, since_pk, reached, seen, typed_at = await sync_to_async(_tick)(
                user, other, since_ts, since_pk, reached, seen, typed_at,
            )
            for name, payload in events:
                event_id = payload.pop('event_id', None)
                frame = json.dumps(payload, cls=DjangoJSONEncoder, separators=(',', ':'))
                yield f"event: {name}\n" + (f'id: {event_id}\n' if event_id else '') + f'data: {frame}\n\n'
            if not events:
                yield ': keepalive\n\n'
    finally:
        stop_watching(user.pk, other.pk)
        release(user.pk)
        try:
            await layer.group_discard(group, channel)
        except Exception:  # noqa: BLE001 - a loop already on its way out cannot be argued with
            pass


async def thread_stream(request, username):
    """GET /api/messages/<who>/stream/ — this thread, from now on."""
    user = await sync_to_async(stream_user)(request)
    if user is None:
        return JsonResponse({'detail': 'Authentication required.'}, status=401)
    if user.is_suspended:
        return JsonResponse({'detail': 'Account suspended.'}, status=403)
    other = await sync_to_async(
        User.objects.filter(username=username, is_active=True).first
    )()
    if other is None or other.pk == user.pk:
        return JsonResponse({'detail': 'No such thread.'}, status=404)

    since_ts, since_pk = timezone.now() - BACKFILL, 0
    raw = request.headers.get('Last-Event-ID') or request.GET.get('last_event_id') or ''
    if raw and '|' in raw:
        iso, _, pk = raw.rpartition('|')
        parsed = parse_datetime(iso)
        # An unreadable cursor keeps the backfill window rather than failing: a
        # reconnect that starts a little early shows rows the cache already has.
        if parsed:
            since_ts, since_pk = parsed, int(pk or 0) if pk.isdigit() else 0

    if not acquire(user.pk, settings.SSE_STREAMS_PER_USER):
        return JsonResponse(
            {'detail': 'Too many live streams for this account. Close a tab and try again.'}, status=429,
        )

    response = StreamingHttpResponse(
        _thread_events(user, other, since_ts, since_pk,
                       settings.CHAT_SSE_INTERVAL, settings.SSE_MAX_LIFE),
        content_type='text/event-stream',
    )
    response['Cache-Control'] = 'no-cache, no-transform'
    response['X-Accel-Buffering'] = 'no'
    return response
