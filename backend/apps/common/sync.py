"""One round-trip that hydrates the client cache: session, graph edges, saves and counters.

Bounded by design — only the signed-in user's own graph is returned, so the payload does
not grow with the size of the platform. Lists (feed, comments, followers, threads) stay
on their own keyset-paginated endpoints.
"""

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.follows.models import Block, Follow
from apps.follows.suggest import suggested_accounts
from apps.messages.models import Message
from apps.notifications.models import Notification
from apps.promotions.models import Promotion
from apps.saved.models import SavedListing, SavedPost
from apps.wallet.models import Wallet

from .api import person
from .config import client_config

GRAPH_LIMIT = 400
# The follow graph has to be complete for state correctness, not just fresh:
# an edge truncated out of this window renders a Follow button that the server
# then refuses, so the window per user is wider than any seeded roster.
EDGE_LIMIT = 1000
# Warmth only: the rail and the See-all screen read the wider list from their
# own endpoint, so the bootstrap carries enough rows to fill the first glance.
SUGGEST_LIMIT = 12


def _role(user):
    if user.is_superuser:
        return 'superadmin'
    if user.is_staff:
        return 'admin'
    return 'user'


def me_payload(user):
    profile = user.profile
    wallet = Wallet.objects.filter(user=user).first()
    suspended = user.is_suspended
    return {
        'id': user.pk,
        'username': user.username,
        'email': user.email,
        'name': profile.display_name or user.get_full_name() or user.username,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'bio': profile.bio,
        'avatar': profile.avatar_url,
        'cover': profile.cover_url,
        'location': profile.location,
        'province': profile.province,
        'website': profile.website,
        'phone': profile.phone,
        'links': profile.links,
        'role': _role(user),
        'is_staff': user.is_staff,
        'is_superuser': user.is_superuser,
        'verified': profile.verified,
        'emailVerified': user.email_verified,
        'provider': user.provider,
        'dob': user.date_of_birth,
        'country': user.country,
        'city': user.city,
        'private': profile.is_private,
        'twoStep': profile.two_step,
        'notifyEmail': profile.notify_email,
        'joined': user.date_joined,
        'coins': int(wallet.balance) if wallet else 0,
        'susp': {'until': user.suspended_until, 'reason': user.suspend_reason} if suspended else None,
        'lockedUntil': user.locked_until,
    }


def _cards(ids):
    rows = (
        User.objects.filter(pk__in=ids)
        .select_related('profile')
        .annotate(followers_count=Count('followers', filter=Q(followers__status='accepted'), distinct=True))
        .order_by('pk')[:GRAPH_LIMIT]
    )
    cards = []
    for row in rows:
        card = person(row)
        card['followers'] = row.followers_count
        card['following'] = row.following.filter(status=Follow.Status.ACCEPTED).count()
        card['role'] = _role(row)
        cards.append(card)
    return cards


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync(request):
    user = request.user
    edges = (
        Follow.objects.filter(Q(follower=user) | Q(followee=user))
        .order_by('-created_at')[:EDGE_LIMIT]
    )
    edge_rows = [
        {
            'id': edge.pk,
            'follower': edge.follower_id,
            'following': edge.followee_id,
            'status': edge.status,
            'ts': edge.created_at,
        }
        for edge in edges
    ]
    graph_ids = {edge.follower_id for edge in edges} | {edge.followee_id for edge in edges}

    # Both sides of every block the viewer is party to: the client only needs
    # its own side, since that is the list it can lift.
    my_blocks = list(Block.objects.filter(blocker=user).values_list('blocked_id', flat=True)[:EDGE_LIMIT])

    suggestion_rows = []
    for row, mutuals in suggested_accounts(user, limit=SUGGEST_LIMIT):
        card = person(row)
        card['followers'] = row.followers_count
        card['role'] = _role(row)
        card['mutuals'] = mutuals
        suggestion_rows.append(card)
    graph_ids |= {card['id'] for card in suggestion_rows}
    graph_ids |= set(my_blocks)

    wallet = Wallet.objects.filter(user=user).first()
    saves = list(SavedPost.objects.filter(user=user).values_list('post_id', flat=True)[:GRAPH_LIMIT])
    listing_saves = list(SavedListing.objects.filter(user=user).values_list('listing_id', flat=True)[:GRAPH_LIMIT])

    unread_notifications = Notification.objects.filter(
        recipient=user, read_at__isnull=True
    ).count()
    unread_messages = Message.objects.filter(
        read_at__isnull=True, conversation__participants=user
    ).exclude(sender=user).count()
    own_promotions = Promotion.objects.filter(owner=user).order_by('-created_at')[:20]

    return Response({
        'me': me_payload(user),
        'people': _cards(graph_ids),
        'suggestions': suggestion_rows,
        'follows': edge_rows,
        'blocks': my_blocks,
        'saves': {'posts': saves, 'listings': listing_saves},
        'promotions': [
            {
                'id': promo.pk,
                'owner': promo.owner_id,
                'target_type': promo.target_type,
                'target_id': promo.target_id,
                'category': promo.category,
                'age_min': promo.age_min,
                'age_max': promo.age_max,
                'country': promo.country,
                'city': promo.city,
                'budget': promo.budget,
                'status': promo.status,
                'package': promo.package,
                'impressions': promo.impressions,
                'clicks': promo.clicks,
                'created_at': promo.created_at,
                'ends_at': promo.ends_at,
            }
            for promo in own_promotions
        ],
        'wallet': {
            'balance': wallet.balance if wallet else 0,
            'currency': wallet.currency if wallet else 'NPR',
        },
        'unread': {'notifications': unread_notifications, 'messages': unread_messages},
        'config': client_config(),
        'server_time': timezone.now(),
    })
