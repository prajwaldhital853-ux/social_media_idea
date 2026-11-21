from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.pagination import KeysetPagination, decode_cursor
from apps.follows.models import Follow
from apps.notifications.services import notify

from .models import Conversation, Message


class MessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)

    class Meta:
        model = Message
        fields = ['id', 'conversation', 'sender', 'sender_username', 'text', 'read_at', 'created_at']
        read_only_fields = ['id', 'conversation', 'sender', 'read_at', 'created_at']


def _other(conversation, user):
    return conversation.participants.exclude(pk=user.pk).select_related('profile').first()


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
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs.prefetch_related('participants__profile'), request)
    results = []
    for conversation in rows:
        other = _other(conversation, request.user)
        last = conversation.messages.order_by('-created_at').first()
        unread = conversation.messages.filter(sender=other, read_at__isnull=True).count() if other else 0
        results.append({
            'conversation': conversation.pk,
            'user': {'id': other.pk, 'username': other.username, 'name': other.profile.display_name, 'avatar_url': other.profile.avatar_url} if other else None,
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
        response.data['mutuals'] = [
            {'user': {'id': u.pk, 'username': u.username, 'name': u.profile.display_name, 'avatar_url': u.profile.avatar_url}, 'mutual': True}
            for u in mutual_users
        ]
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
        notify(other, request.user, 'message', f'{request.user.username} sent you a message.', 'user', request.user.pk)
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
    count = conversation.messages.filter(sender=other, read_at__isnull=True).update(read_at=timezone.now())
    return Response({'read': count})