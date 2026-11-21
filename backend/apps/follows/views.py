from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.pagination import KeysetPagination
from apps.notifications.services import notify
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
    try:
        with transaction.atomic():
            edge, created = Follow.objects.get_or_create(
                follower=request.user, followee=target,
                defaults={'status': Follow.Status.PENDING if private else Follow.Status.ACCEPTED},
            )
    except IntegrityError:
        return Response({'detail': 'Already following or requested.'}, status=400)
    if not created:
        return Response({'detail': 'Already following or requested.', 'status': edge.status}, status=400)
    if private:
        notify(target, request.user, 'follow_request', f'{request.user.username} requested to follow you.', 'user', request.user.pk)
    else:
        notify(target, request.user, 'follow', f'{request.user.username} started following you.', 'user', request.user.pk)
    return Response({'status': edge.status}, status=status.HTTP_201_CREATED)


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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def followers(request, username):
    target = get_object_or_404(User, username=username)
    qs = Follow.objects.filter(followee=target, status=Follow.Status.ACCEPTED)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs.select_related('follower__profile'), request)
    return paginator.get_paginated_response(FollowUserSerializer([e.follower for e in rows], many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def following(request, username):
    target = get_object_or_404(User, username=username)
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