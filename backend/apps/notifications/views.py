from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.api import person
from apps.common.pagination import KeysetPagination
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