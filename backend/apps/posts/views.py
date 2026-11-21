from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticatedOrReadOnly, SAFE_METHODS
from rest_framework.response import Response

from apps.common.pagination import KeysetPagination
from apps.promotions.services import promoted_for

from .models import Post
from .serializers import PostSerializer


class IsAuthorOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.method in SAFE_METHODS or obj.author_id == request.user.id


def visible_posts(user):
    qs = Post.objects.select_related('author__profile').prefetch_related('media')
    if user.is_authenticated and user.is_staff:
        return qs
    visible = Q(status=Post.Status.LIVE, audience=Post.Audience.PUBLIC)
    if user.is_authenticated:
        visible |= Q(author=user)
        visible |= Q(
            status=Post.Status.LIVE,
            audience=Post.Audience.FOLLOWERS,
            author__followers__follower=user,
            author__followers__status='accepted',
        )
    return qs.filter(visible).distinct()


class PostViewSet(viewsets.ModelViewSet):
    serializer_class = PostSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, IsAuthorOrReadOnly]

    def get_queryset(self):
        qs = visible_posts(self.request.user)
        author = self.request.query_params.get('author')
        if author:
            qs = qs.filter(author__username=author)
        query = (self.request.query_params.get('q') or '').strip()
        if query:
            qs = qs.filter(Q(text__icontains=query) | Q(category__iexact=query.lstrip('#')))
        # The reels shelf is a stream of its own: posts that carry moving pictures.
        if self.request.query_params.get('media') == 'video':
            qs = qs.filter(media__kind='video').distinct()
        return qs

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)


def promo_card(promo):
    return {
        'id': promo.pk, 'owner': promo.owner_id, 'target_type': promo.target_type,
        'target_id': promo.target_id, 'category': promo.category,
        'age_min': promo.age_min, 'age_max': promo.age_max,
        'country': promo.country, 'city': promo.city, 'package': promo.package,
        'budget': promo.budget, 'status': promo.status,
        'impressions': promo.impressions, 'clicks': promo.clicks,
        'created_at': promo.created_at, 'ends_at': promo.ends_at,
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def feed(request):
    """Newest-first ordinary feed; matching promoted posts lead the first page."""
    cursor = request.query_params.get('cursor')
    following = bool(request.query_params.get('following'))
    # The sponsored slot belongs at the head of a newest-first page. On an
    # ascending walk it would sit above rows that are chronologically older.
    promos = [] if (cursor or following or request.query_params.get('order') == 'oldest') else [
        p for p in promoted_for(request.user) if p.target_type == 'post' and p.target_id.isdigit()]
    promo_ids = [int(p.target_id) for p in promos]
    promo_by_post = {promo_id: promo for promo_id, promo in zip(promo_ids, promos)}
    qs = visible_posts(request.user)
    if following:
        # The Following tab is exactly the people the viewer chose; nobody gets
        # sponsored posts or strangers there, and an anonymous visitor gets nothing.
        qs = qs.none() if not request.user.is_authenticated else qs.filter(
            author__followers__follower=request.user, author__followers__status='accepted',
        )
    if promo_ids:
        qs = qs.exclude(pk__in=promo_ids)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    data = PostSerializer(rows, many=True, context={'request': request}).data
    for item in data:
        item['promoted'] = False
    if promo_ids:
        found = {p.pk: p for p in Post.objects.filter(
            pk__in=promo_ids, status=Post.Status.LIVE
        ).select_related('author__profile').prefetch_related('media')}
        lead_posts = [found[post_id] for post_id in promo_ids if post_id in found]
        lead = PostSerializer(lead_posts, many=True, context={'request': request}).data
        for item in lead:
            promo = promo_by_post[item['id']]
            item['promoted'] = True
            item['promo_id'] = promo.pk
            item['promo'] = promo_card(promo)
        data = lead + data
    return paginator.get_paginated_response(data)
