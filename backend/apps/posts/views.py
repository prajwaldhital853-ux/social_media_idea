from django.db.models import Exists, F, OuterRef, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticatedOrReadOnly, SAFE_METHODS
from rest_framework.response import Response

from apps.common.pagination import KeysetPagination
from apps.common.ratelimit import client_ip, enforce
from apps.follows.models import Block, Follow
from apps.promotions.services import plan, serving

from .models import Post, PostMedia
from .serializers import PostSerializer


class IsAuthorOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.method in SAFE_METHODS or obj.author_id == request.user.id


def visible_posts(user):
    qs = Post.objects.select_related('author__profile').prefetch_related('media').filter(status=Post.Status.LIVE)
    # A block closes the door on both sides: you do not see what you blocked, and
    # you do not see what blocked you.
    if user.is_authenticated:
        qs = qs.exclude(
            Q(author_id__in=Block.objects.filter(blocker=user).values('blocked_id'))
            | Q(author_id__in=Block.objects.filter(blocked=user).values('blocker_id'))
        )
    # A private account is private whatever the author picked as the audience:
    # only approved followers get its posts, and a pending request gets nothing.
    visible = Q(audience=Post.Audience.PUBLIC) & ~Q(author__profile__is_private=True)
    if user.is_authenticated:
        visible |= Q(author=user)
        # A follower test as a subquery rather than as a join on author__followers:
        # the join is what forced every feed query into a DISTINCT over the whole
        # row, and "does the viewer follow this author" is one boolean either way.
        visible |= Exists(
            Follow.objects.filter(followee=OuterRef('author'), follower=user, status=Follow.Status.ACCEPTED)
        )
    return qs.filter(visible)


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
        # Exists, not media__kind: one clip per post would otherwise be one row
        # per clip and a DISTINCT to tidy it back up.
        if self.request.query_params.get('media') == 'video':
            qs = qs.filter(Exists(PostMedia.objects.filter(post=OuterRef('pk'), kind='video')))
        return qs

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    @property
    def paginator(self):
        """`order=views` sorts on a count instead of a timestamp, so that shelf
        walks its own index and needs a cursor built for it."""
        if self.request is not None and self.request.query_params.get('order') == 'views':
            if not hasattr(self, '_views_paginator'):
                self._views_paginator = KeysetPagination(sort_field='views')
            return self._views_paginator
        if not hasattr(self, '_paginator'):
            self._paginator = self.pagination_class() if self.pagination_class else None
        return self._paginator


@api_view(['POST'])
@permission_classes([AllowAny])
def share_post(request, pk):
    """Record one share of one post.

    The link is already out of the app's hands when the client reports it, so
    this is a tally rather than a transaction: it can only ever go up, and a
    visitor who shares the same post twice is counted twice.
    """
    enforce(f'share:{client_ip(request)}', 30, 60)
    if not visible_posts(request.user).filter(pk=pk).exists():
        return Response({'detail': 'No such post.'}, status=status.HTTP_404_NOT_FOUND)
    Post.objects.filter(pk=pk).update(share_count=F('share_count') + 1)
    return Response({'share_count': Post.objects.filter(pk=pk).values_list('share_count', flat=True).first()})


@api_view(['POST'])
@permission_classes([AllowAny])
def count_view(request, pk):
    """One reel watched. A view is cheap to grant and expensive to fake, so the
    limit is generous and the count is a tally rather than a unique-audience measure."""
    enforce(f'view:{client_ip(request)}', 120, 60)
    if not visible_posts(request.user).filter(pk=pk).exists():
        return Response({'detail': 'No such post.'}, status=status.HTTP_404_NOT_FOUND)
    Post.objects.filter(pk=pk).update(views=F('views') + 1)
    return Response({'views': Post.objects.filter(pk=pk).values_list('views', flat=True).first()})


def promo_card(promo):
    return {
        'id': promo.pk, 'owner': promo.owner_id, 'target_type': promo.target_type,
        'target_id': promo.target_id, 'category': promo.category,
        'age_min': promo.age_min, 'age_max': promo.age_max,
        'country': promo.country, 'cities': list(promo.cities or []), 'package': promo.package,
        'budget': promo.budget, 'status': promo.status,
        'impressions': promo.impressions, 'clicks': promo.clicks,
        'created_at': promo.created_at, 'starts_at': promo.starts_at, 'ends_at': promo.ends_at,
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def feed(request):
    """Newest-first ordinary feed; matching promoted posts lead the first page."""
    cursor = request.query_params.get('cursor')
    following = bool(request.query_params.get('following'))
    # The sponsored slot belongs at the head of a newest-first page. On an
    # ascending walk it would sit above rows that are chronologically older.
    dial = None
    promos = []
    if not (cursor or following or request.query_params.get('order') == 'oldest'):
        promos, dial = plan(request.user, KeysetPagination.page_size, target_type='post')
        promos = [p for p in promos if p.target_id.isdigit()]
    promo_ids = [int(p.target_id) for p in promos]
    promo_by_post = {promo_id: promo for promo_id, promo in zip(promo_ids, promos)}
    qs = visible_posts(request.user)
    if following:
        # The Following tab is exactly the people the viewer chose; nobody gets
        # sponsored posts or strangers there, and an anonymous visitor gets nothing.
        qs = qs.none() if not request.user.is_authenticated else qs.filter(
            Exists(Follow.objects.filter(
                followee=OuterRef('author'), follower=request.user, status=Follow.Status.ACCEPTED,
            ))
        )
    if promo_ids:
        qs = qs.exclude(pk__in=promo_ids)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    data = PostSerializer(rows, many=True, context={'request': request}).data
    for item in data:
        item['promoted'] = False
    if promo_ids:
        # The sponsored slot is still a post: a private author or a followers-only
        # ad must not reach a stranger because somebody paid for it.
        found = {p.pk: p for p in visible_posts(request.user).filter(
            pk__in=promo_ids, status=Post.Status.LIVE
        )}
        served = [promo_by_post[post_id] for post_id in promo_ids if post_id in found]
        lead = PostSerializer([found[post_id] for post_id in promo_ids if post_id in found],
                              many=True, context={'request': request}).data
        for item, promo in zip(lead, served):
            item['promoted'] = True
            item['promo_id'] = promo.pk
            item['promo'] = promo_card(promo)
        # The gap the desk asked for is measured in ordinary posts, so a second
        # paid card waits that many rows behind the first. A card that never gets
        # its gap is not shown, and is not written to the ledger either: the reach
        # a payer is charged for is the reach a person actually saw.
        step = max(1, dial['gap']) if dial else 1
        paid = list(zip(lead, served))
        merged, since, shown = [], 0, []
        if paid:
            card, promo = paid.pop(0)
            merged.append(card)
            shown.append(promo)
        for item in data:
            if paid and since >= step:
                card, promo = paid.pop(0)
                merged.append(card)
                shown.append(promo)
                since = 0
            merged.append(item)
            since += 1
        data = merged
        serving(request.user, shown)
    return paginator.get_paginated_response(data)
