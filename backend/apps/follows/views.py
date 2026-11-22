from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.pagination import KeysetPagination
from apps.notifications.services import email_activity, notify
from apps.profiles.models import Profile

from .models import Follow


class FollowUserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='profile.display_name', read_only=True)
    avatar_url = serializers.CharField(source='profile.avatar_url', read_only=True)
    verified = serializers.BooleanField(source='profile.verified', read_only=True)
    is_private = serializers.BooleanField(source='profile.is_private', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'name', 'avatar_url', 'verified', 'is_private']


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def follow(request):
    target = get_object_or_404(User, username=request.data.get('username'))
    if target.pk == request.user.pk:
        return Response({'detail': 'You cannot follow yourself.'}, status=400)
    profile = getattr(target, 'profile', None)
    private = bool(profile and profile.is_private)
    # A POST on an edge that already exists is a stale client, not a violation:
    # a double-tap, another device, or a sync window that dropped the row. It
    # answers with the true state so the button settles instead of erroring.
    try:
        with transaction.atomic():
            edge, created = Follow.objects.get_or_create(
                follower=request.user, followee=target,
                defaults={'status': Follow.Status.PENDING if private else Follow.Status.ACCEPTED},
            )
    except IntegrityError:
        edge = Follow.objects.filter(follower=request.user, followee=target).first()
        if edge is None:
            return Response({'detail': 'Could not follow. Try again.'}, status=500)
        created = False
    if created:
        kind = 'follow_request' if private else 'follow'
        verb = 'requested to follow you' if private else 'started following you'
        notify(target, request.user, kind, f'{request.user.username} {verb}.', 'user', request.user.pk)
        email_activity(target, request.user, kind)
    return Response({'status': edge.status, 'created': created}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def unfollow(request, username):
    target = get_object_or_404(User, username=username)
    deleted, _ = Follow.objects.filter(follower=request.user, followee=target).delete()
    if not deleted:
        return Response({'detail': 'No follow edge to remove.'}, status=404)
    return Response({'detail': 'Removed.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def requests_list(request):
    edges = Follow.objects.filter(followee=request.user, status=Follow.Status.PENDING).select_related('follower__profile')
    results = []
    for edge in edges:
        data = FollowUserSerializer(edge.follower).data
        data['request_id'] = edge.pk
        results.append(data)
    return Response({'results': results})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_action(request, pk, action):
    edge = get_object_or_404(Follow, pk=pk, followee=request.user, status=Follow.Status.PENDING)
    if action == 'accept':
        edge.status = Follow.Status.ACCEPTED
        edge.save(update_fields=['status'])
        notify(edge.follower, request.user, 'follow_accept', f'{request.user.username} accepted your follow request.', 'user', request.user.pk)
        return Response({'status': 'accepted'})
    edge.delete()
    return Response({'status': 'declined'})


def _circle_is_public(request, target):
    """A public account shows who follows it. A private one shows that circle only
    to itself, to staff, and to followers it has already accepted."""
    private = Profile.objects.filter(user=target).values_list('is_private', flat=True).first()
    if not private:
        return True
    user = request.user
    if not user.is_authenticated:
        return False
    if user.pk == target.pk or user.is_staff:
        return True
    return Follow.objects.filter(follower=user, followee=target, status=Follow.Status.ACCEPTED).exists()


def _empty_page():
    return Response({'results': [], 'next_cursor': None, 'has_more': False})


@api_view(['GET'])
@permission_classes([AllowAny])
def followers(request, username):
    target = get_object_or_404(User, username=username)
    if not _circle_is_public(request, target):
        return _empty_page()
    qs = Follow.objects.filter(followee=target, status=Follow.Status.ACCEPTED)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs.select_related('follower__profile'), request)
    return paginator.get_paginated_response(FollowUserSerializer([e.follower for e in rows], many=True).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def following(request, username):
    target = get_object_or_404(User, username=username)
    if not _circle_is_public(request, target):
        return _empty_page()
    qs = Follow.objects.filter(follower=target, status=Follow.Status.ACCEPTED)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs.select_related('followee__profile'), request)
    return paginator.get_paginated_response(FollowUserSerializer([e.followee for e in rows], many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def mutuals(request):
    mine = set(Follow.objects.filter(follower=request.user, status=Follow.Status.ACCEPTED).values_list('followee_id', flat=True))
    theirs = set(Follow.objects.filter(followee=request.user, status=Follow.Status.ACCEPTED).values_list('follower_id', flat=True))
    ids = mine & theirs
    users = User.objects.filter(pk__in=ids).select_related('profile')
    return Response({'results': FollowUserSerializer(users, many=True).data})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def state(request, username):
    target = get_object_or_404(User, username=username)
    edge = Follow.objects.filter(follower=request.user, followee=target).first()
    incoming = Follow.objects.filter(follower=target, followee=request.user, status=Follow.Status.ACCEPTED).exists()
    return Response({
        'state': edge.status if edge else ('follows_me' if incoming else 'none'),
        'follows_me': incoming,
    })