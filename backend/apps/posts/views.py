import random

from django.core.cache import cache
from django.db.models import Exists, F, OuterRef, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticatedOrReadOnly, SAFE_METHODS
from rest_framework.response import Response

from apps.common.errors import throttle_text
from apps.common.pagination import KeysetPagination
from apps.common.rules import blocked_wording, post_limits_gate, rate, room, seat, write_gate
from apps.follows.models import Block, Follow
from apps.promotions.services import plan, serving

from .models import Post, PostMedia
from .serializers import PostSerializer

# How far a signed-out reader may walk the feed, and how long a stranger's first
# page is served without touching the database again.
ANON_FEED_ROWS = 30
FEED_CACHE_SECONDS = 15


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

    def list(self, request, *args, **kwargs):
        """A stranger's first page is the one answer every anonymous client asks for.

        It is cached for a few seconds keyed on the exact query, so a thousand
        visitors opening the app in the same quarter minute read one database
        query instead of a thousand. Only page one, and only without a search
        term: search terms and cursors are attacker-chosen text, and each unique
        one would plant a cache entry of its own.
        """
        if request.user.is_authenticated or request.query_params.get('cursor') or request.query_params.get('q'):
            response = super().list(request, *args, **kwargs)
            return self._deal(request, response)
        key = f'feed-anon:{request.get_full_path()}'
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)
        response = super().list(request, *args, **kwargs)
        self._deal(request, response)
        cache.set(key, response.data, FEED_CACHE_SECONDS)
        return response

    def _deal(self, request, response):
        """The reels shelf is a discovery stream, so a fresh open deals a fresh
        hand: nobody opens the same reel first twice in a row. A shelf that is
        a question about one person (their profile), a search, or a walk in a
        chosen order keeps the order it was asked for, and a cursor page keeps
        its own order so the walk stays stable under inserts. A stranger reading
        a cached page was dealt the hand the cache entry was planted with."""
        params = request.query_params
        if (params.get('media') == 'video' and not params.get('author')
                and not params.get('q') and not params.get('order') and not params.get('cursor')
                and response.status_code == 200 and isinstance(response.data, dict)):
            random.shuffle(response.data['results'])
        return response

    def create(self, request, *args, **kwargs):
        """Blocked wording, the desk's ceilings and blocked links are all answered here.

        Nothing is written on any of them, so a post the console has ruled out never
        reaches the feed to be hunted through it afterwards.
        """
        refused = blocked_wording(request, 'post')
        if refused:
            return refused
        refused = write_gate(request, 'post')
        if refused:
            return refused
        refused = post_limits_gate(request)
        if refused:
            return refused
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        """So is an edit that puts the wording back in after the fact, or one that
        re-commits more attachments than the limits desk allows."""
        refused = blocked_wording(request, 'post')
        if refused:
            return refused
        refused = post_limits_gate(request)
        if refused:
            return refused
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    @property
    def paginator(self):
        """`order=views` sorts on a count instead of a timestamp, so that shelf
        walks its own index and needs a cursor built for it. Both shelves hand
        their signed-out readers the same bounded walk."""
        if self.request is not None and self.request.query_params.get('order') == 'views':
            if not hasattr(self, '_views_paginator'):
                self._views_paginator = KeysetPagination(sort_field='views', anon_cap=ANON_FEED_ROWS)
            return self._views_paginator
        if not hasattr(self, '_paginator'):
            self._paginator = KeysetPagination(anon_cap=ANON_FEED_ROWS)
        return self._paginator


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def share_post(request, pk):
    """Ask whether the share button may answer, then record one share of one post.

    A GET spends nothing: it is the button asking before it opens the sheet, so a
    reader past the ceiling is stopped where they can see it rather than told nothing
    happened while the link quietly left. A POST is the record itself, and it is
    refused by the same ceiling, so the asking is a courtesy and not the rule.

    The link is already out of the app's hands when the client reports it, so
    this is a tally rather than a transaction: it can only ever go up, and a
    visitor who shares the same post twice is counted twice.
    """
    bucket = f'share:{seat(request)}'
    if request.method == 'GET':
        allowed = room(bucket, 'spam_share_per_minute', 60, 30)
        if allowed:
            return Response({'allowed': True})
        return Response({'allowed': False, 'detail': throttle_text(60), 'retry_in': 60})
    rate(bucket, 'spam_share_per_minute', 60, 30)
    if not visible_posts(request.user).filter(pk=pk).exists():
        return Response({'detail': 'No such post.'}, status=status.HTTP_404_NOT_FOUND)
    Post.objects.filter(pk=pk).update(share_count=F('share_count') + 1)
    return Response({'share_count': Post.objects.filter(pk=pk).values_list('share_count', flat=True).first()})


@api_view(['POST'])
@permission_classes([AllowAny])
def count_view(request, pk):
    """One reel watched. A view is cheap to grant and expensive to fake, so the
    limit is generous and the count is a tally rather than a unique-audience measure.
    It is counted per person, not per address: two hundred readers out of one college
    wifi are two hundred people, and a reel still plays when its counter refuses."""
    rate(f'view:{seat(request)}', 'spam_view_per_minute', 60, 120)
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
    """Newest-first ordinary feed; matching promoted posts lead the first page.

    A stranger's first page is the one answer every anonymous client asks for, so
    it is served from a short cache and the database hears the question once per
    quarter-minute instead of once per stranger. Only page one is cached: a
    cursor is caller-chosen text, and every unique one would plant an entry of
    its own. The cache skips nothing a stranger's page would have done — the
    promotion desk answers nobody who is not signed in, and the impression
    ledger only moves for people it can name.
    """
    if not request.user.is_authenticated and not request.query_params.get('cursor'):
        key = f'feed-anon:{request.get_full_path()}'
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)
        response = _feed_page(request)
        cache.set(key, response.data, FEED_CACHE_SECONDS)
        return response
    return _feed_page(request)


def _feed_page(request):
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
    paginator = KeysetPagination(anon_cap=ANON_FEED_ROWS)
    rows = paginator.paginate_queryset(qs, request)
    data = PostSerializer(rows, many=True, context={'request': request}).data
    for item in data:
        item['promoted'] = False
    if not following and not request.query_params.get('order') and not cursor:
        # For You is a discovery shelf: the newest window is dealt in a fresh
        # order on every read, so two arrivals never open on the same screenful
        # even when nobody has posted. Deeper pages keep the walk's own order,
        # because a cursor has to stay stable under inserts, and the people a
        # reader chose (Following, oldest) are listed in the order they chose.
        random.shuffle(data)
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
