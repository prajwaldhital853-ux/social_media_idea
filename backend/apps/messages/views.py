from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.api import person
from apps.common.pagination import KeysetPagination, decode_cursor
from apps.follows.models import Follow
from apps.notifications.models import Notification
from apps.notifications.services import notify_latest

from .models import Conversation, Message
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


def _other(conversation, user):
    return conversation.participants.exclude(pk=user.pk).select_related('profile').first()


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
    qs = Conversation.objects.filter(participants=request.user).exclude(last_message_at__isnull=True)
    # An inbox walks by the last message, not by when the thread was opened:
    # the conversation you typed in a second ago belongs at the top.
    paginator = KeysetPagination('last_message_at')
    rows = paginator.paginate_queryset(qs.prefetch_related('participants__profile'), request)
    results = []
    for conversation in rows:
        other = _other(conversation, request.user)
        _mark_delivered(conversation, request.user)
        last = conversation.messages.order_by('-created_at').first()
        unread = conversation.messages.filter(sender=other, read_at__isnull=True).count() if other else 0
        results.append({
            'conversation': conversation.pk,
            'user': person(other) if other else None,
            'last_message': MessageSerializer(last).data if last else None,
            'unread': unread,
            'mutual': False,
        })
    response = paginator.get_paginated_response(results)
    if not request.query_params.get('cursor'):
        mine = set(Follow.objects.filter(follower=request.user, status='accepted').values_list('followee_id', flat=True))
        theirs = set(Follow.objects.filter(followee=request.user, status='accepted').values_list('follower_id', flat=True))
        talked = set()
        for conversation in Conversation.objects.filter(participants=request.user):
            other = _other(conversation, request.user)
            if other:
                talked.add(other.pk)
        mutual_users = User.objects.filter(pk__in=(mine & theirs) - talked).select_related('profile')
        response.data['mutuals'] = [{'user': person(u), 'mutual': True} for u in mutual_users]
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
        conversation = _get_or_create_conversation(request.user, other)
        with transaction.atomic():
            message = Message.objects.create(conversation=conversation, sender=request.user, text=text)
            Conversation.objects.filter(pk=conversation.pk).update(last_message_at=message.created_at)
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
