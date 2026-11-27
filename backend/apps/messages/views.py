from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.api import person
from apps.common.pagination import KeysetPagination, decode_cursor
from apps.follows.models import Block, Follow
from apps.notifications.models import Notification
from apps.notifications.services import notify_latest

from .models import Conversation, ConversationHide, Message
from .consumer import broadcast_message, broadcast_read
from .presence import is_watching, note_typing


class MessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'conversation', 'sender', 'sender_username', 'text', 'status', 'read_at', 'created_at']
        read_only_fields = ['id', 'conversation', 'sender', 'read_at', 'created_at']

    def get_status(self, obj):
        # One of three receipt states: left my client, reached the recipient's,
        # seen by them. Anything past sent renders as a double tick.
        if obj.read_at:
            return 'read'
        if obj.delivered_at:
            return 'delivered'
        return 'sent'


def _inbox_cards(request, ids):
    """One page of the inbox, in four queries instead of five per row.

    Reading the thread list row by row used to ask for the other person, the last
    message, the unread count and the receipt stamp separately for each of the ten
    conversations — sixty round trips before an inbox appeared.
    """
    me = request.user.pk
    edges = Conversation.participants.through.objects.filter(conversation_id__in=ids).exclude(
        user_id=me,
    ).select_related('user__profile')
    others = {edge.conversation_id: edge.user for edge in edges}
    latest = {
        message.conversation_id: message
        for message in Message.objects.filter(conversation_id__in=ids).select_related('sender__profile')
        .order_by('conversation_id', '-created_at').distinct('conversation_id')
    }
    unread = {
        row['conversation_id']: row['total']
        for row in Message.objects.filter(conversation_id__in=ids, read_at__isnull=True)
        .exclude(sender_id=me).values('conversation_id').annotate(total=Count('id'))
    }
    # Fetching a thread proves the message reached this device.
    Message.objects.filter(conversation_id__in=ids, delivered_at__isnull=True).exclude(
        sender_id=me,
    ).update(delivered_at=timezone.now())
    cards = []
    for conversation_id in ids:
        other = others.get(conversation_id)
        message = latest.get(conversation_id)
        cards.append({
            'conversation': conversation_id,
            'user': person(other) if other else None,
            'last_message': MessageSerializer(message).data if message else None,
            'unread': unread.get(conversation_id, 0) if other else 0,
            'mutual': False,
        })
    return cards


def _mark_delivered(conversation, reader):
    """Anything the reader just fetched was proven to have reached their device."""
    return conversation.messages.exclude(sender=reader).filter(delivered_at__isnull=True).update(delivered_at=timezone.now())


def _get_or_create_conversation(user, other):
    existing = Conversation.objects.filter(participants=user).filter(participants=other).first()
    if existing:
        return existing
    lo, hi = sorted((user.pk, other.pk))
    with transaction.atomic():
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s)', [(lo << 32) | hi])
        existing = Conversation.objects.filter(participants=user).filter(participants=other).first()
        if existing:
            return existing
        conversation = Conversation.objects.create()
        conversation.participants.set([user, other])
    return conversation


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def inbox(request):
    # A thread somebody blocked out of their inbox — either direction of a block,
    # or their own Delete Conversation — is not a row they asked to keep seeing.
    hidden = ConversationHide.objects.filter(user=request.user).values_list('conversation_id', flat=True)
    blocked_others = {
        blocked if blocker == request.user.pk else blocker
        for blocker, blocked in Block.objects.filter(
            Q(blocker=request.user) | Q(blocked=request.user)
        ).values_list('blocker_id', 'blocked_id')
    }
    qs = (Conversation.objects.filter(participants=request.user)
          .exclude(last_message_at__isnull=True)
          .exclude(pk__in=hidden)
          .exclude(participants__id__in=blocked_others))
    # An inbox walks by the last message, not by when the thread was opened:
    # the conversation you typed in a second ago belongs at the top.
    paginator = KeysetPagination('last_message_at')
    rows = paginator.paginate_queryset(qs, request)
    ids = [conversation.pk for conversation in rows]
    response = paginator.get_paginated_response(_inbox_cards(request, ids))
    if not request.query_params.get('cursor'):
        # The band above the threads is everyone this reader follows and has not
        # written to yet — one-way by design: following someone puts them in MY
        # inbox, and they only see the thread once a message actually crosses.
        # Blocks cut both ways, in either direction, and talked threads are
        # already in the list below.
        mine = set(Follow.objects.filter(follower=request.user, status='accepted').values_list('followee_id', flat=True))
        blocked = set(
            Block.objects.filter(Q(blocker=request.user) | Q(blocked=request.user))
            .values_list('blocker_id', 'blocked_id')
        )
        blocked_ids = {(b if a == request.user.pk else a) for a, b in blocked}
        mine_ids = Conversation.participants.through.objects.filter(
            user_id=request.user.pk,
        ).values_list('conversation_id', flat=True)
        talked = set(
            Conversation.participants.through.objects.filter(conversation_id__in=mine_ids)
            .exclude(user_id=request.user.pk).values_list('user_id', flat=True)
        )
        band_users = User.objects.filter(pk__in=mine - talked - blocked_ids).select_related('profile')
        theirs = set(Follow.objects.filter(followee=request.user, status='accepted').values_list('follower_id', flat=True))
        response.data['mutuals'] = [{'user': person(u), 'mutual': u.pk in theirs} for u in band_users]
    return response


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def thread(request, username):
    other = get_object_or_404(User, username=username)
    if other.pk == request.user.pk:
        return Response({'detail': 'You cannot message yourself.'}, status=400)
    if request.method == 'POST':
        text = (request.data.get('text') or '').strip()
        if not text:
            return Response({'detail': 'Message text is required.'}, status=400)
        if len(text) > 2000:
            return Response({'detail': 'Message too long (2000 characters max).'}, status=400)
        if Block.objects.filter(
            Q(blocker=request.user, blocked=other) | Q(blocker=other, blocked=request.user)
        ).exists():
            # A block is a closed door in both directions: an open thread window
            # does not keep it ajar.
            return Response({'detail': 'You cannot message this account.'}, status=403)
        conversation = _get_or_create_conversation(request.user, other)
        with transaction.atomic():
            message = Message.objects.create(conversation=conversation, sender=request.user, text=text)
            Conversation.objects.filter(pk=conversation.pk).update(last_message_at=message.created_at)
            # A message that crosses puts the thread back into an inbox it was
            # deleted from — for both ends of it.
            ConversationHide.objects.filter(conversation=conversation).delete()
        # A bell for a message the reader is watching happen is a second ping for
        # one event, and the one they did not ask for. Only whoever is away gets
        # told; whoever is here already sees the bubble land.
        if not is_watching(other.pk, request.user.pk):
            notify_latest(other, request.user, 'message', f'{request.user.username} sent you a message.', 'user', request.user.pk)
        broadcast_message(message, [request.user.pk, other.pk])
        return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)
    conversation = Conversation.objects.filter(participants=request.user).filter(participants=other).first()
    if not conversation:
        return Response({'results': [], 'next_cursor': None, 'has_more': False, 'conversation': None})
    qs = conversation.messages.select_related('sender')
    cursor = decode_cursor(request.query_params.get('cursor'))
    if cursor:
        ts, pk = cursor
        qs = qs.filter(Q(created_at__lt=ts) | Q(created_at=ts, pk__lt=pk))
    rows = list(qs.order_by('-created_at', '-pk')[:11])
    has_more = len(rows) > 10
    rows = rows[:10]
    rows.reverse()
    # Fetching the thread proves delivery of everything addressed to the reader,
    # including the older pages this page did not carry.
    _mark_delivered(conversation, request.user)
    from apps.common.pagination import encode_cursor
    return Response({
        'conversation': conversation.pk,
        'results': MessageSerializer(rows, many=True).data,
        'next_cursor': encode_cursor(rows[0]) if has_more and rows else None,
        'has_more': has_more,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_read(request, username):
    other = get_object_or_404(User, username=username)
    conversation = Conversation.objects.filter(participants=request.user).filter(participants=other).first()
    if not conversation:
        return Response({'read': 0})
    _mark_delivered(conversation, request.user)
    count = conversation.messages.filter(sender=other, read_at__isnull=True).update(read_at=timezone.now())
    # Reading the thread reads the bells it came from. Without this the same
    # message sits in the tray as "new" after the reader has already answered it
    # — and anyone who arrived from the profile, not the tray, never clears it.
    notifications = Notification.objects.filter(
        recipient=request.user, actor=other, kind='message', read_at__isnull=True,
    ).update(read_at=timezone.now())
    if count:
        broadcast_read(request.user.pk, [request.user.pk, other.pk], count)
    return Response({'read': count, 'notifications': notifications})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_conversation(request, username):
    """Take one thread out of MY inbox only. The other participant keeps theirs
    untouched — deleting is not retracting what was said — and a message from
    them later puts the thread back, because an inbox that permanently swallowed
    new mail from someone would be a silent block instead of a delete."""
    other = get_object_or_404(User, username=username)
    conversation = Conversation.objects.filter(participants=request.user).filter(participants=other).first()
    if not conversation:
        return Response({'detail': 'Conversation deleted.'})
    ConversationHide.objects.get_or_create(conversation=conversation, user=request.user)
    Notification.objects.filter(
        recipient=request.user, actor=other, kind='message', read_at__isnull=True,
    ).update(read_at=timezone.now())
    return Response({'detail': 'Conversation deleted.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def typing(request, username):
    """A keystroke, aimed at one thread. Nothing to answer and nothing to keep.

    The socket carries this for free when it is open; this is the same tell for
    every client whose handshake never made it through the proxy in front of the
    app, and it is deliberately cheap: one cache write, no row, no fan-out.
    """
    other = get_object_or_404(User, username=username)
    if other.pk != request.user.pk:
        note_typing(request.user.pk, other.pk)
    return Response({'ok': True})
