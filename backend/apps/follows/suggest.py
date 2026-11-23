"""Suggestion candidates justified by the viewer's own follow graph.

An account only earns a Follow button when somebody one edge away from the
viewer is already connected to it, so the reach is walked two hops out from the
person asking rather than ranked over the whole platform.
"""

from django.db.models import Count, Q

from apps.accounts.models import User

from .models import Block, Follow

NEIGHBOR_LIMIT = 1000
EDGE_LIMIT = 20000
ACCEPTED = Follow.Status.ACCEPTED
FOLLOWERS = Count('followers', filter=Q(followers__status=ACCEPTED), distinct=True)


def neighbors_of(user):
    """Everyone one accepted edge away, in either direction."""
    rows = (
        Follow.objects.filter(Q(follower=user) | Q(followee=user))
        .exclude(status=Follow.Status.PENDING)
        .values_list('follower_id', 'followee_id')[:NEIGHBOR_LIMIT]
    )
    ids = set()
    for follower_id, followee_id in rows:
        ids.add(followee_id if follower_id == user.pk else follower_id)
    ids.discard(user.pk)
    return ids


def suggested_accounts(user, limit=30):
    """[(account, mutual_connections)], best justified first.

    A signed-out visitor has no graph to walk, so they get the accounts the
    platform is proud of; anybody with a session only sees people their own
    circle touches.
    """
    if not user or not user.is_authenticated:
        popular = (
            User.objects.filter(is_active=True, is_staff=False)
            .select_related('profile')
            .annotate(followers_count=FOLLOWERS)
            .order_by('-profile__verified', '-followers_count', 'pk')[:limit]
        )
        return [(row, 0) for row in popular]

    neighbors = neighbors_of(user)
    if not neighbors:
        return []

    # One edge between a neighbour and anybody else is the whole justification,
    # and the number of neighbours behind a candidate is its rank.
    reach = {}
    edges = (
        Follow.objects.filter(Q(follower__in=neighbors) | Q(followee__in=neighbors))
        .exclude(status=Follow.Status.PENDING)
        .values_list('follower_id', 'followee_id')[:EDGE_LIMIT]
    )
    for follower_id, followee_id in edges:
        for near, other in ((follower_id, followee_id), (followee_id, follower_id)):
            if near in neighbors and other != user.pk:
                reach.setdefault(other, set()).add(near)

    # Someone the viewer already asked about is not a suggestion, and neither is
    # anybody on either side of a block or still waiting on the viewer.
    taken = set(Follow.objects.filter(follower=user).values_list('followee_id', flat=True))
    taken |= set(
        Follow.objects.filter(followee=user, status=Follow.Status.PENDING).values_list('follower_id', flat=True)
    )
    taken |= set(Block.objects.filter(blocker=user).values_list('blocked_id', flat=True))
    taken |= set(Block.objects.filter(blocked=user).values_list('blocker_id', flat=True))

    candidates = (
        User.objects.filter(pk__in=set(reach) - taken, is_active=True, is_staff=False)
        .select_related('profile')
        .annotate(followers_count=FOLLOWERS)
    )
    ranked = sorted(
        candidates,
        key=lambda row: (-len(reach[row.pk]), not row.profile.verified, -row.followers_count, row.pk),
    )[:limit]
    return [(row, len(reach[row.pk])) for row in ranked]
