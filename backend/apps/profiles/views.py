from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.pagination import KeysetPagination
from apps.follows.models import Follow

from .models import Profile


class ProfileSerializer(serializers.ModelSerializer):
    # Every other person payload carries the account id; without it the client
    # cannot tell this row is the same person a feed card already holds.
    id = serializers.IntegerField(source='user_id', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    name = serializers.CharField(source='display_name', required=False, allow_blank=True)
    dob = serializers.DateField(source='user.date_of_birth', required=False, allow_null=True)
    country = serializers.CharField(source='user.country', required=False, allow_blank=True)
    city = serializers.CharField(source='user.city', required=False, allow_blank=True)

    class Meta:
        model = Profile
        fields = [
            'id', 'username', 'name', 'bio', 'avatar_url', 'cover_url', 'location', 'province',
            'website', 'verified', 'is_private', 'two_step', 'dob', 'country', 'city',
        ]
        read_only_fields = ['id', 'username', 'verified']

    def update(self, instance, validated_data):
        user_data = validated_data.pop('user', {})
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if user_data:
            for attr, value in user_data.items():
                setattr(instance.user, attr, value)
            instance.user.save(update_fields=list(user_data.keys()))
        return instance


def _counts(user):
    return {
        'posts': user.posts.filter(status='live').count(),
        'followers': Follow.objects.filter(followee=user, status='accepted').count(),
        'following': Follow.objects.filter(follower=user, status='accepted').count(),
    }


def _can_view_full(viewer, target):
    if viewer.is_authenticated and (viewer.pk == target.pk or viewer.is_staff):
        return True
    profile = getattr(target, 'profile', None)
    if not profile or not profile.is_private:
        return True
    return viewer.is_authenticated and Follow.objects.filter(
        follower=viewer, followee=target, status='accepted',
    ).exists()


@api_view(['GET', 'PATCH'])
@permission_classes([AllowAny])
def profile_detail(request, username):
    user = get_object_or_404(User, username=username)
    profile = get_object_or_404(Profile, user=user)
    if request.method == 'PATCH':
        if not request.user.is_authenticated or request.user.pk != user.pk:
            return Response({'detail': 'You can only edit your own profile.'}, status=403)
        serializer = ProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
    full = _can_view_full(request.user, user)
    data = ProfileSerializer(profile).data
    data.update(_counts(user))
    data['joined'] = user.date_joined
    data['locked'] = not full
    if not full:
        data = {k: data[k] for k in ('username', 'name', 'avatar_url', 'verified', 'is_private', 'locked', 'followers', 'following', 'posts')}
    return Response(data)


@api_view(['GET'])
@permission_classes([AllowAny])
def user_search(request):
    """People search for the search page, @-mentions and the picker."""
    qs = (
        User.objects.filter(is_active=True)
        .select_related('profile')
        .annotate(
            created_at=F('date_joined'),
            posts_count=Count('posts', distinct=True),
            followers_count=Count('followers', distinct=True),
        )
    )
    query = (request.query_params.get('q') or '').strip().lstrip('@')
    if query:
        qs = qs.filter(
            Q(username__icontains=query) | Q(first_name__icontains=query)
            | Q(last_name__icontains=query) | Q(profile__display_name__icontains=query)
        )
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    edges = {}
    if request.user.is_authenticated:
        edges = dict(Follow.objects.filter(follower=request.user).values_list('followee_id', 'status'))
    data = []
    for row in rows:
        card = {
            'id': row.pk,
            'username': row.username,
            'name': row.profile.display_name or row.get_full_name() or row.username,
            'avatar_url': row.profile.avatar_url,
            'bio': row.profile.bio,
            'verified': row.profile.verified,
            'is_private': row.profile.is_private,
            'followers': row.followers_count,
            'posts': row.posts_count,
            'joined': row.date_joined,
        }
        card['follow_state'] = edges.get(row.pk, 'none')
        data.append(card)
    return paginator.get_paginated_response(data)
