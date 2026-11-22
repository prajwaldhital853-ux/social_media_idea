"""Shared helpers that let one API round-trip render a screen without N+1 fetches."""

from django.db.models import Count

from apps.posts.models import PostMedia
from apps.reactions.models import Reaction


def person(user):
    if user is None:
        return None
    profile = getattr(user, 'profile', None)
    return {
        'id': user.pk,
        'username': user.username,
        'name': (profile.display_name if profile else '') or user.get_full_name() or user.username,
        'avatar_url': profile.avatar_url if profile else '',
        'cover_url': profile.cover_url if profile else '',
        'bio': profile.bio if profile else '',
        'verified': bool(profile.verified) if profile else False,
        'is_private': bool(profile.is_private) if profile else False,
    }


def reaction_map(user, target_type, ids):
    """kind per target id for the current user — one query for a whole page."""
    if not user or not user.is_authenticated or not ids:
        return {}
    rows = Reaction.objects.filter(
        user=user, target_type=target_type, target_id__in=[str(i) for i in ids]
    ).values_list('target_id', 'kind')
    return dict(rows)


def user_reaction_map(request, target_type, ids):
    return reaction_map(getattr(request, 'user', None), target_type, ids)


def kind_counts(target_type, ids):
    """{target_id: {kind: n}} for a page of targets — one grouped query."""
    if not ids:
        return {}
    rows = Reaction.objects.filter(
        target_type=target_type, target_id__in=[str(i) for i in ids]
    ).values('target_id', 'kind').annotate(n=Count('id'))
    out: dict = {}
    for row in rows:
        out.setdefault(row['target_id'], {})[row['kind']] = row['n']
    return out


def post_page_reactions(request, posts):
    """My reaction plus the whole page's per-kind aggregates — five queries total.

    The aggregates are public: a signed-out visitor sees how a post was
    received, only *whose* reaction was theirs stays behind the login.
    """
    user = getattr(request, 'user', None)
    post_ids = [post.pk for post in posts]
    media_ids = [
        f'{post_id}#m{position}'
        for post_id, position in PostMedia.objects.filter(post_id__in=post_ids).values_list('post_id', 'position')
    ]
    mine = reaction_map(user, 'post', post_ids)
    mine_media = reaction_map(user, 'media', media_ids)
    return {
        'post': mine,
        'media': mine_media,
        'post_kinds': kind_counts('post', post_ids),
        'media_kinds': kind_counts('media', media_ids),
    }
