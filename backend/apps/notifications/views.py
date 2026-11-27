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
from apps.adminpanel import rbac
from apps.adminpanel.models import PublicNotice, StaffAccount
from apps.comments.models import Comment
from apps.common.api import person
from apps.common.pagination import KeysetPagination
from apps.common.stream import acquire, release, stream_user
from apps.marketplace.models import Listing
from apps.messages.models import Message
from apps.posts.models import Post
from .models import PushSubscription
from apps.posts.views import visible_posts

from . import push
from .models import Notification, PushSubscription

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


def _post_visible(user_pk, post_id):
    user = User.objects.filter(pk=user_pk, is_active=True).first()
    return bool(user and not user.is_suspended and visible_posts(user).filter(pk=post_id).exists())


def _staff_permissions(user_pk):
    user = User.objects.filter(pk=user_pk, is_active=True, is_staff=True).first()
    if not user or user.is_suspended:
        return None
    seat = StaffAccount.objects.filter(user_id=user_pk, is_enabled=True).first()
    if seat is None or not seat.is_enrolled:
        return None
    keys = set(rbac.permissions_for(seat))
    return keys or None


NOTICE_KINDS = {'report', 'coin_request', 'signup', 'coin_proof', 'promotion', 'alert'}


def _staff_allowed(permissions, frame):
    kind = frame.get('kind')
    if kind == 'staff_notice' or (kind in NOTICE_KINDS and frame.get('route')):
        permission = frame.get('permission')
        if isinstance(permission, str) and permission:
            return permission in permissions
        route = str(frame.get('route') or '')
        if route.startswith('/coins'):
            needed = {'coins_view', 'coins_review'}
        elif route.startswith('/people'):
            needed = {'users'}
        elif route.startswith('/promotions'):
            needed = {'promotions_view'}
        elif route.startswith('/reports'):
            needed = {'reports'}
        elif route.startswith('/policy'):
            needed = {'blocked_words'}
        elif route.startswith('/alerts'):
            needed = {'alerts'}
        else:
            return False
        return bool(permissions & needed)
    if kind in {'comment', 'post_new', 'reaction'}:
        return bool(permissions & {'content', 'reports', 'overview', 'notices', 'listings'})
    if kind == 'coin_request':
        return bool(permissions & {'coins_view', 'coins_review'})
    if kind == 'coins':
        return bool(permissions & {'coins_view', 'coins_review', 'coin_ledger'})
    if kind == 'promotion':
        return bool(permissions & {'promotions_view', 'promotions_review'})
    if kind == 'warning':
        return bool(permissions & {'users', 'user_actions', 'warnings'})
    return kind == 'audit'


async def _notification_events(user_pk, since_ts, interval, max_life, since_pk=0, post_id=None, staff=False, lease=''):
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
    groups = [f'post.{post_id}'] if post_id else (['staff'] if staff else [user_group, 'site'])
    for group in groups:
        await layer.group_add(group, channel)
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
            if landed:
                if post_id and not await sync_to_async(_post_visible)(user_pk, post_id):
                    return
                if staff:
                    permissions = await sync_to_async(_staff_permissions)(user_pk)
                    if permissions is None:
                        return
                    allowed = []
                    for frame in landed:
                        try:
                            payload = json.loads(frame)
                        except (TypeError, ValueError):
                            continue
                        if isinstance(payload, dict) and _staff_allowed(permissions, payload):
                            allowed.append(frame)
                    landed = allowed
            for frame in landed:
                yield f'event: pulse\ndata: {frame}\n\n'
            if post_id or staff:
                if not landed:
                    yield ': keepalive\n\n'
                continue
            rows = await sync_to_async(_since)(user_pk, since_ts, since_pk)
            for row in rows:
                since_ts, since_pk = row['created_at'], row['pk']
                payload = json.dumps(row['data'], cls=DjangoJSONEncoder, separators=(',', ':'))
                yield f"event: notification\nid: {row['event_id']}\ndata: {payload}\n\n"
            if not rows and not landed:
                yield ': keepalive\n\n'
    finally:
        release(user_pk, lease)
        drainer.cancel()
        for group in groups:
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

    staff_mode = request.GET.get('staff') == '1'
    if staff_mode:
        request.user = user
        denied = await sync_to_async(rbac.check)(request, [])
        if denied is not None:
            return JsonResponse(dict(denied.data), status=denied.status_code)

    post_id = None
    raw_post = request.GET.get('post')
    if raw_post:
        if not raw_post.isdigit():
            return JsonResponse({'detail': 'No such post.'}, status=404)
        post_id = int(raw_post)
        if not await sync_to_async(_post_visible)(user.pk, post_id):
            return JsonResponse({'detail': 'No such post.'}, status=404)

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

    lease = acquire(user.pk, settings.SSE_STREAMS_PER_USER)
    if not lease:
        return JsonResponse({'detail': 'Too many live streams for this account. Close a tab and try again.'}, status=429)

    response = StreamingHttpResponse(
        _notification_events(
            user.pk, since_ts, settings.SSE_INTERVAL, settings.SSE_MAX_LIFE, since_pk,
            post_id=post_id, staff=staff_mode, lease=lease,
        ),
        content_type='text/event-stream',
    )
    response['Cache-Control'] = 'no-cache, no-transform'
    response['X-Accel-Buffering'] = 'no'
    # no-transform is load-bearing: Next's proxy (and any compression layer in
    # front of us) reads this header and skips gzipping the stream. A gzipped
    # event-stream stays open but its frames never parse in the browser.
    return response

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def push_config(request):
    """What a browser needs before it asks its own user for permission.

    The public half of the VAPID pair is the only thing that leaves the server:
    it names us to the push service, and the private half never travels. A
    member's browser should not spend a permission prompt on a platform that
    has no keys configured, so `enabled` says so first.

    With `endpoint` in the query, `filed` answers the question a switch must
    actually show: does the server hold *this* browser's address under the seat
    signed in now? Chrome files one address per browser however many accounts
    live in it, so a subscription the browser can see may belong to somebody
    else — a switch that only asked the browser would stay lit over an address
    the member away from this desk is receiving.
    """
    endpoint = str(request.query_params.get('endpoint') or '')[:512]
    filed = False
    if endpoint:
        filed = PushSubscription.objects.filter(user=request.user, endpoint=endpoint).exists()
    return Response({'enabled': push.configured(), 'public_key': push.public_key(), 'filed': filed})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def push_subscribe(request):
    """File one browser. Sending the same endpoint again moves it to whoever is
    signed in now, which is what a shared family machine does all day."""
    endpoint = str(request.data.get('endpoint') or '')[:512]
    keys = request.data.get('keys') or {}
    p256dh = str(keys.get('p256dh') or '')[:120]
    auth = str(keys.get('auth') or '')[:64]
    # An endpoint is an address this server will POST to with a signed claim, so
    # it is only ever taken from an HTTPS push service. Without that, a member
    # could aim the platform's notifications at any host and any origin they own.
    if not endpoint.startswith('https://') or not p256dh or not auth:
        return Response({'detail': 'That browser subscription is not usable.'}, status=400)
    row, _ = PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={'user': request.user, 'p256dh': p256dh, 'auth': auth, 'fails': 0},
    )
    return Response({'subscribed': True, 'id': row.pk})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def push_unsubscribe(request):
    """Forget one browser, for the member who turns the switch off.

    Scoped to the caller on purpose: the endpoint is the only handle the browser
    has, and a guess must not be able to silence somebody else's phone.
    """
    endpoint = str(request.data.get('endpoint') or '')[:512]
    if not endpoint:
        return Response({'detail': 'No subscription was named.'}, status=400)
    gone, _ = PushSubscription.objects.filter(endpoint=endpoint, user=request.user).delete()
    return Response({'unsubscribed': gone})
