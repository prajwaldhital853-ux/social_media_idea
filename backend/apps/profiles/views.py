from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
import re
from urllib.parse import urlparse
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.api import person
from apps.common.pagination import KeysetPagination
from apps.follows.models import Follow
from apps.follows.suggest import suggested_accounts
from apps.posts.services import announce_profile_change

from .models import Profile


def _is_http_url(value):
    """Only http(s) may reach the About section: those links open in a new tab."""
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme in ('http', 'https') and bool(parsed.netloc)


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
            'website', 'phone', 'links', 'verified', 'is_private', 'two_step', 'notify_email',
            'dob', 'country', 'city',
        ]
        read_only_fields = ['id', 'username', 'verified']

    def validate_website(self, value):
        value = (value or '').strip()
        if value and not _is_http_url(value):
            raise serializers.ValidationError('Use a full http(s) address.')
        return value

    def validate_phone(self, value):
        value = (value or '').strip()
        if value and not re.fullmatch(r'[+]?[0-9 ()-]{6,40}', value):
            raise serializers.ValidationError('Use digits, spaces, brackets or a leading +.')
        return value

    def validate_links(self, value):
        """About-section links open in a new tab, so only http(s) may be stored."""
        if not isinstance(value, list):
            raise serializers.ValidationError('Links must be a list.')
        if len(value) > 8:
            raise serializers.ValidationError('Up to 8 links.')
        clean = []
        for item in value:
            if not isinstance(item, dict):
                raise serializers.ValidationError('Each link needs a label and a url.')
            url = str(item.get('url') or '').strip()
            label = str(item.get('label') or '').strip()[:40]
            if not _is_http_url(url):
                raise serializers.ValidationError(f'"{url or "this link"}" is not a web address.')
            clean.append({'label': label, 'url': url})
        return clean

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
        before = (profile.avatar_url, profile.cover_url)
        serializer = ProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # A new photo or banner is published as its own feed card, but only when
        # the value actually moved — saving the form twice must not post twice.
        for old, new, kind in (
            (before[0], profile.avatar_url, 'profile'),
            (before[1], profile.cover_url, 'cover'),
        ):
            if new and new != old:
                announce_profile_change(user, kind, new)
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
            posts_count=Count('posts', filter=Q(posts__status='live'), distinct=True),
            followers_count=Count('followers', filter=Q(followers__status='accepted'), distinct=True),
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


@api_view(['GET'])
@permission_classes([AllowAny])
def user_suggestions(request):
    """The friend-of-a-friend roster, best justified first.

    One bounded page, not a cursor: the rail and the See-all screen read the
    same rows, and nobody is asked to walk ten thousand suggestions.
    """
    try:
        limit = min(max(int(request.query_params.get('limit') or 30), 1), 60)
    except (TypeError, ValueError):
        limit = 30
    edges = {}
    if request.user.is_authenticated:
        edges = dict(Follow.objects.filter(follower=request.user).values_list('followee_id', 'status'))
    data = []
    for row, mutuals in suggested_accounts(request.user, limit=limit):
        card = person(row)
        card['followers'] = row.followers_count
        card['role'] = 'user'
        card['mutuals'] = mutuals
        card['follow_state'] = edges.get(row.pk, 'none')
        data.append(card)
    return Response({'results': data, 'next_cursor': None, 'has_more': False})
