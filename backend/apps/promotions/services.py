"""Who is actually shown a campaign somebody paid for.

The payer buys two things: a run of days and an audience. The audience is decided
here, out of what the platform knows about the person holding the feed — the age
and the country they gave the site, the categories they keep coming back to,
whether they already follow the payer, and what they did to this very post. Each
of those is worth what the admin console says it is worth: the dials for likes,
comments, saves, reel watches, follows and audience matching used to be typed into
this file, which made "the Admin can change how reach is chosen" a sentence nobody
could act on. They are rows now and this reads the rows.

Three rules hold the rest of it together. A person is not shown the same campaign
twice in one day. A campaign stops being served once the impression ledger says it
has reached as far as its package promised. And what a payer is charged against is
the ledger's own count, never a number a client POSTs.
"""

from datetime import timedelta

from django.db import IntegrityError, transaction as db_atomic
from django.db.models import Count, F, Q
from django.utils import timezone
from django.utils.dateparse import parse_date

from .models import Promotion, PromoImpression

# The numbers the platform shipped with, so a feed still scores the same way on a
# server where nobody has opened the desk and the settings row does not exist yet.
SHIPPED = {
    'algo_weight_like': 3,
    'algo_weight_comment': 4,
    'algo_weight_save': 5,
    'algo_weight_watch': 1,
    'algo_weight_follow': 6,
    'promo_weight_target': 1,
    'algo_relevance_floor': 2,
    'promo_daily_cap': 2,
    'promo_repeat_limit': 3,
    'promo_organic_gap': 4,
    'promo_global_pause': False,
}

INTEREST_WINDOW_DAYS = 30
AGE_FLOOR, AGE_CEIL = 13, 65
# interest_score runs on the first feed page, and a category's post ids are the
# one input that grows with the platform rather than with the viewer. The score
# only orders a couple of promotions, so it reads the newest slice of the
# category: the alternative was pulling every id the category ever made into
# memory and pasting them all into one IN list. Ordering by created_at lets the
# newest-first index stop as soon as the slice is full.
INTEREST_POSTS = 500


def _whole(value, fallback):
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return fallback


def controls():
    """The dials the console turns, read once per page and never guessed at."""
    try:
        from apps.adminpanel import settings_store
        typed = settings_store.values()
    except Exception:  # noqa: BLE001 - a missing settings table must not take the feed down
        typed = {}
    return {
        'weights': {key: _whole(typed.get(key), SHIPPED[key]) for key in (
            'algo_weight_like', 'algo_weight_comment', 'algo_weight_save',
            'algo_weight_watch', 'algo_weight_follow',
        )},
        'target': _whole(typed.get('promo_weight_target'), SHIPPED['promo_weight_target']),
        'floor': _whole(typed.get('algo_relevance_floor'), SHIPPED['algo_relevance_floor']),
        'daily': _whole(typed.get('promo_daily_cap'), SHIPPED['promo_daily_cap']),
        'repeat': _whole(typed.get('promo_repeat_limit'), SHIPPED['promo_repeat_limit']),
        'gap': _whole(typed.get('promo_organic_gap'), SHIPPED['promo_organic_gap']),
        'paused': bool(typed.get('promo_global_pause', SHIPPED['promo_global_pause'])),
    }


def age_of(user):
    """Their age as the site can work it out, or None when nobody ever told it."""
    dob = user.date_of_birth
    if isinstance(dob, str):
        dob = parse_date(dob)
    if not dob:
        return None
    today = timezone.now().date()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _intervals(promo, user):
    """One answer per narrowing the payer asked for: True, False, or None when the
    person never told the site that much about themselves.

    A filter the payer left open is not an answer, so it cannot add points — an
    advert aimed at everybody only looks targeted because nobody was excluded.
    """
    years = age_of(user)
    out = []
    if promo.age_min > AGE_FLOOR or promo.age_max < AGE_CEIL:
        out.append(years is not None and promo.age_min <= years <= promo.age_max)
    if promo.country:
        out.append(_said(user.country, promo.country))
    if promo.city:
        out.append(_said(user.city, promo.city))
    return out


def _said(theirs, asked):
    """Compare two place names the site may never have been told, or may have been
    told twice with different capitalisation. None means the person never said."""
    if not theirs:
        return None
    return str(theirs).lower() == str(asked).lower()


def audience_matches(promo, user):
    """The hard filters: what the person said about themselves, and the payer's band.

    An age the site was never told only clears a campaign that is willing to show
    itself to anybody old enough to have an account, because a payer who asked for
    thirties and got a fourteen-year-old is a complaint, not a rounding error. A
    country or city nobody typed is only a blank box, so it is not held against
    them — it just earns no audience points.
    """
    if not user.is_authenticated:
        return False
    if promo.owner_id == user.pk:
        return True
    return not any(answer is False for answer in _intervals(promo, user))


def _category_ids(category):
    from apps.posts.models import Post
    return [str(pk) for pk in Post.objects.filter(category=category)
            .order_by('-created_at').values_list('id', flat=True)[:INTEREST_POSTS]]


def follows(owner_id, user):
    from apps.follows.models import Follow
    return Follow.objects.filter(
        follower=user, followee_id=owner_id, status=Follow.Status.ACCEPTED,
    ).exists()


class Affinity:
    """The viewer's history, counted once per page and reused by every campaign.

    Three campaigns in the same category used to ask the same four COUNT questions
    three times over on the hottest door the site has.
    """

    def __init__(self, user, weights, target_weight=0):
        self.user = user
        self.weights = weights
        self.target_weight = target_weight
        self.since = timezone.now() - timedelta(days=INTEREST_WINDOW_DAYS)
        self._categories = {}
        self._owners = {}
        self._touch = {}

    def category(self, name):
        """What this person did with this category recently, in the console's points."""
        if not name:
            return self.reels()
        if name not in self._categories:
            from apps.reactions.models import Reaction
            from apps.saved.models import SavedPost
            post_ids = _category_ids(name)
            likes = Reaction.objects.filter(
                user=self.user, target_type='post', target_id__in=post_ids,
                created_at__gte=self.since,
            ).count() if post_ids else 0
            comments = self.user.comments.filter(
                post__category=name, created_at__gte=self.since,
            ).count()
            saves = SavedPost.objects.filter(
                user=self.user, post__category=name, created_at__gte=self.since,
            ).count()
            self._categories[name] = (
                likes * self.weights['algo_weight_like']
                + comments * self.weights['algo_weight_comment']
                + saves * self.weights['algo_weight_save']
                + self.reels()
            )
        return self._categories[name]

    def reels(self):
        """A reel watched is a reel played, counted wherever it came from."""
        if 'reels' not in self._categories:
            from apps.reactions.models import Reaction
            self._categories['reels'] = Reaction.objects.filter(
                user=self.user, target_type='media', created_at__gte=self.since,
            ).count() * self.weights['algo_weight_watch']
        return self._categories['reels']

    def owner(self, owner_id):
        """Whether they chose to follow the payer: the plainest thing the site
        knows about whether this person wants to see more of them."""
        if owner_id not in self._owners:
            self._owners[owner_id] = (
                self.weights['algo_weight_follow'] if follows(owner_id, self.user) else 0
            )
        return self._owners[owner_id]

    def touch(self, promo):
        """What this person did to the very thing being promoted.

        Someone who saved or argued under a post is not a spent lead — they are the
        likeliest reader the platform can find, so the paid card goes to them and
        the payer gets the engagement they bought rather than a stranger's scroll.
        """
        key = (promo.target_type, str(promo.target_id))
        if key not in self._touch:
            from apps.comments.models import Comment
            from apps.reactions.models import Reaction
            from apps.saved.models import SavedPost
            pk = int(key[1]) if key[0] == 'post' and key[1].isdigit() else None
            if pk is None:
                self._touch[key] = 0
            else:
                likes = Reaction.objects.filter(
                    user=self.user, target_type='post', target_id=key[1]).count()
                comments = Comment.objects.filter(author=self.user, post_id=pk).count()
                saves = SavedPost.objects.filter(user=self.user, post_id=pk).exists()
                self._touch[key] = (
                    likes * self.weights['algo_weight_like']
                    + comments * self.weights['algo_weight_comment']
                    + (self.weights['algo_weight_save'] if saves else 0)
                )
        return self._touch[key]

    def audience(self, promo, user):
        """The payer's own narrowing, in points per filter this person is inside.

        Age, country and city are what the person typed into the promotion form, so
        they count for something even when the viewer has never touched this
        category — otherwise a campaign bought by somebody with no history at all
        would be unbuyable on day one.
        """
        return self.target_weight * sum(1 for ok in _intervals(promo, user) if ok is True)

    def score(self, promo, user):
        """Everything this campaign is worth showing to this person, in one number."""
        return (self.touch(promo) + self.category(promo.category) + self.owner(promo.owner_id)
                + self.audience(promo, user))


def interest_score(user, category, weights=None):
    """The score one category earns for this person — kept for the ranking tests
    and the desk, which ask about a category rather than a campaign."""
    tuned = weights or controls()['weights']
    return Affinity(user, tuned).category(category)


def people_reached(promo_ids):
    """How many separate people each campaign has been handed to.

    A package sells "up to 3,000 people", not 3,000 scroll-past seconds, so the
    promise is measured in people. The ledger lets one person add a row a day, so
    counting rows would let a campaign reach its ceiling on a hundred regulars.
    """
    if isinstance(promo_ids, int):
        return PromoImpression.objects.filter(
            promotion_id=promo_ids).values('viewer').distinct().count()
    rows = (PromoImpression.objects.filter(promotion_id__in=promo_ids)
            .values('promotion_id').annotate(people=Count('viewer', distinct=True)))
    return {row['promotion_id']: row['people'] for row in rows}


def _shelf():
    """The admin-edited catalog, by id. An empty shelf means the desk is not on."""
    try:
        from apps.adminpanel import promotions as desk
        return {pack['id']: pack for pack in desk.packages()}
    except Exception:  # noqa: BLE001 - the shelf is a nicety; the run is the contract
        return {}


def seen_today(user):
    """Campaigns this person was already handed today — the daily cap, in rows."""
    return set(PromoImpression.objects.filter(
        viewer=user, day=timezone.now().date(),
    ).values_list('promotion_id', flat=True))


def serving(user, promos, today=None):
    """Write down what the page showed, and move the counter with it.

    One row per campaign per person per day, and the campaign's own tally only
    ever goes up when a row was really added — so the number a payer is charged
    against is the number the ledger can be read back to.
    """
    if not promos or not user.is_authenticated:
        return 0
    day = today or timezone.now().date()
    written = 0
    for promo in promos:
        try:
            with db_atomic.atomic():
                PromoImpression.objects.create(promotion=promo, viewer=user, day=day)
                Promotion.objects.filter(pk=promo.pk).update(impressions=F('impressions') + 1)
                written += 1
        except IntegrityError:
            # Another page of theirs got there first; a duplicate is not reach.
            continue
    return written


def candidates(user, limit=2, target_type=None, tuned=None):
    """The campaigns this person may be shown right now, most likely first."""
    dial = tuned or controls()
    if dial['paused'] or not user.is_authenticated:
        return []
    running = Promotion.objects.filter(status=Promotion.Status.ACTIVE).filter(
        Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now())
    ).select_related('owner')
    if target_type:
        running = running.filter(target_type=target_type)
    promos = list(running)
    if not promos:
        return []
    already = seen_today(user)
    # The daily cap is what one person may be handed in a day, so the ones they
    # already saw today are spent before this page asks for more.
    room = max(0, dial['daily'] - len(already))
    shelf = _shelf()
    promised = {promo.pk: int((shelf.get(str(promo.package or '')) or {}).get('reach_max') or 0)
                for promo in promos}
    reached = people_reached([pk for pk, cap in promised.items() if cap]) if any(promised.values()) else {}
    scores = Affinity(user, dial['weights'], dial['target'])
    picked = []
    for promo in promos:
        if promo.pk in already:
            continue
        if dial['repeat'] and PromoImpression.objects.filter(
            promotion=promo, viewer=user,
        ).count() >= dial['repeat']:
            continue
        if promised[promo.pk] and reached.get(promo.pk, 0) >= promised[promo.pk]:
            continue
        if not audience_matches(promo, user):
            continue
        score = scores.score(promo, user)
        if promo.owner_id != user.pk and score < dial['floor']:
            continue
        picked.append((-score, -float(promo.budget or 0), promo.created_at, promo))
    # Equally likely people, equally willing payers: the bigger buy leads, and the
    # older campaign leads inside that, so one campaign cannot outwait the rest.
    picked.sort(key=lambda row: (row[0], row[1], row[2]))
    return [row[3] for row in picked][:max(0, min(limit, room))]


def slots(page_size, gap):
    """How many paid cards one page may carry, given the gap the desk asked for.

    A gap of four ordinary posts across a ten-row page is two sponsored cards; a
    gap nobody sets (zero) means the desk is not spacing anything, so one lead is
    still the most a page should open with.
    """
    if gap <= 0:
        return 1
    return max(1, int(page_size) // gap) if page_size else 1


def promoted_for(user, limit=2, target_type=None):
    """Active promotions whose audience matches, most-likely-interested first.

    The shape the feed already calls; `plan` is what the feed should use, because
    a page size and an impression ledger are what make the caps real.
    """
    return candidates(user, limit=limit, target_type=target_type)


def plan(user, page_size=10, target_type=None):
    """The cards to put on this page, and how far apart to put them."""
    dial = controls()
    room = min(slots(page_size, dial['gap']), dial['daily'])
    return candidates(user, limit=room, target_type=target_type, tuned=dial), dial
