from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.pagination import KeysetPagination
from apps.notifications.services import email_activity, notify
from apps.profiles.models import Profile

from .models import Block, Follow


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
    if Block.objects.filter(
        Q(blocker=request.user, blocked=target) | Q(blocker=target, blocked=request.user)
    ).exists():
        return Response({'detail': 'This account cannot be followed.'}, status=403)
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
    # A private account only ever holds one answer per pair, so the row that
    # outlived it is the usual shape of a second request: the follow was dropped
    # from the other side, or an unfollow never reached the database. Answering
    # "already accepted" here would leave the target with nothing to confirm, so
    # the row is re-opened and asked again.
    if private and not created and edge.status != Follow.Status.PENDING:
        edge.status = Follow.Status.PENDING
        edge.save(update_fields=['status'])
        created = True
    if created:
        kind = 'follow_request' if private else 'follow'
        verb = 'requested to follow you' if private else 'started following you'
        notify(target, request.user, kind, f'{request.user.username} {verb}.', 'user', request.user.pk)
        email_activity(target, request.user, kind)
    # Approval is one-way and explicit: following somebody who asked to follow
    # me does not answer their request. They stay pending until I confirm, so
    # two private accounts reach a mutual follow by two separate decisions.
    return Response({'status': edge.status, 'created': created}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def unfollow(request, username):
    target = get_object_or_404(User, username=username)
    deleted, _ = Follow.objects.filter(follower=request.user, followee=target).delete()
    # Same reasoning as a repeat follow: an edge already gone is a stale client,
    # not a failure, and a 404 here bounces an honest unfollow tap into a toast.
    return Response({'detail': 'Removed.' if deleted else 'Nothing to remove.', 'removed': bool(deleted)})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def remove_follower(request, username):
    """Take one person out of my followers without blocking them. Silent: they
    are not told, and my own follow of them is untouched — they simply have to
    ask again to get back in."""
    target = get_object_or_404(User, username=username)
    deleted, _ = Follow.objects.filter(follower=target, followee=request.user).delete()
    return Response({'detail': 'Removed.' if deleted else 'Nothing to remove.', 'removed': bool(deleted)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def block(request):
    """Close the door on one account. Blocking is not a report and is not silent:
    the blocker's own lists stop carrying the person in both directions."""
    target = get_object_or_404(User, username=request.data.get('username'))
    if target.pk == request.user.pk:
        return Response({'detail': 'You cannot block yourself.'}, status=400)
    edge, created = Block.objects.get_or_create(blocker=request.user, blocked=target)
    # A block that left the follow edges standing would keep showing the blocked
    # person under Following, and keep the blocker visible in their followers.
    Follow.objects.filter(
        Q(follower=request.user, followee=target) | Q(follower=target, followee=request.user)
    ).delete()
    return Response(
        {'status': 'blocked', 'created': created},
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def unblock(request, username):
    target = get_object_or_404(User, username=username)
    deleted, _ = Block.objects.filter(blocker=request.user, blocked=target).delete()
    return Response({'detail': 'Unblocked.' if deleted else 'Nothing to remove.', 'removed': bool(deleted)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def blocked(request):
    edges = Block.objects.filter(blocker=request.user).select_related('blocked__profile')
    return Response({'results': FollowUserSerializer([e.blocked for e in edges], many=True).data})


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
    """Answer a follow request.

    A row id the client holds is a snapshot, not a promise: the person may have
    withdrawn, or another device may have answered first. So the body names the
    follower and the edge that is actually standing gets the answer, and one
    already settled answers as itself instead of failing with Django's sentence.
    """
    edge = Follow.objects.filter(pk=pk, followee=request.user).first()
    if edge is None:
        asked = request.data.get('username')
        follower = User.objects.filter(username=asked).first() if asked else None
        edge = (
            Follow.objects.filter(follower=follower, followee=request.user).first()
            if follower is not None else None
        )
    if edge is None:
        return Response({'detail': 'No follow request from that account is waiting.', 'status': 'gone'}, status=404)
    if edge.status != Follow.Status.PENDING:
        return Response({'status': edge.status})
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
        'blocked': Block.objects.filter(blocker=request.user, blocked=target).exists(),
        'blocked_me': Block.objects.filter(blocker=target, blocked=request.user).exists(),
    })