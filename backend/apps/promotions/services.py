from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from .models import Promotion


def audience_matches(promo, user):
    if not user.is_authenticated:
        return False
    if promo.owner_id == user.pk:
        return True
    dob = user.date_of_birth
    if isinstance(dob, str):
        from django.utils.dateparse import parse_date
        dob = parse_date(dob)
    if dob:
        today = timezone.now().date()
        age = today.year - dob.year - (
            (today.month, today.day) < (dob.month, dob.day)
        )
        if not promo.age_min <= age <= promo.age_max:
            return False
    elif promo.age_min > 13:
        return False
    if promo.country and user.country and promo.country.lower() != user.country.lower():
        return False
    if promo.city and user.city and promo.city.lower() != user.city.lower():
        return False
    return True


INTEREST_WINDOW_DAYS = 30
# interest_score runs on the first feed page, and a category's post ids are the
# one input that grows with the platform rather than with the viewer. The score
# only orders a couple of promotions, so it reads the newest slice of the
# category: the alternative was pulling every id the category ever made into
# memory and pasting them all into one IN list. Ordering by created_at lets the
# newest-first index stop as soon as the slice is full.
INTEREST_POSTS = 500


def interest_score(user, category):
    """Recent engagement with same-category content: likes, saves, comments, reel watches."""
    from apps.posts.models import Post
    from apps.reactions.models import Reaction
    from apps.saved.models import SavedPost
    since = timezone.now() - timedelta(days=INTEREST_WINDOW_DAYS)
    post_ids = (
        [
            str(pk) for pk in Post.objects.filter(category=category)
            .order_by('-created_at').values_list('id', flat=True)[:INTEREST_POSTS]
        ]
        if category else []
    )
    likes = Reaction.objects.filter(user=user, target_type='post', target_id__in=post_ids, created_at__gte=since).count()
    comments = user.comments.filter(post__category=category, created_at__gte=since).count() if category else 0
    saves = SavedPost.objects.filter(user=user, post__category=category, created_at__gte=since).count() if category else 0
    reels = Reaction.objects.filter(user=user, target_type='media', created_at__gte=since).count()
    return likes * 3 + comments * 4 + saves * 5 + reels


def promoted_for(user, limit=2):
    """Active promotions whose audience matches, most-likely-interested first."""
    if not user.is_authenticated:
        return []
    promos = Promotion.objects.filter(status=Promotion.Status.ACTIVE).filter(
        Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now())
    ).select_related('owner')
    matching = [p for p in promos if audience_matches(p, user)]
    # One score per category, not per promotion: half a dozen ads in one
    # category used to mean the same four COUNTs six times over.
    scores = {category: interest_score(user, category) for category in {p.category for p in matching}}
    matching.sort(key=lambda p: scores[p.category], reverse=True)
    return matching[:limit]