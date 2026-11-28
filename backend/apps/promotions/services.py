"""Who is actually shown a campaign somebody paid for.

The payer buys two things: a run of days and an audience. The audience is decided
here, out of what the platform knows about the person holding the feed — the age
and the country they gave the site, the categories they keep coming back to,
whether they already follow the payer, and what they did to this very post. Each
of those is worth what the admin console says it is worth: the dials for likes,
comments, saves, shares, reel watches, follows and audience matching used to be
typed into this file, which made "the Admin can change how reach is chosen" a
sentence nobody could act on. They are rows now and this reads the rows.

Three rules hold the rest of it together. One person is handed the same campaign
only as many times in a day as the desk's repeat dial allows. A campaign stops
being served once the impression ledger says it has reached as far as its package
promised. And what a payer is charged against is the ledger's own count, never a
number a client POSTs.
"""

from datetime import timedelta
import statistics

from django.db import IntegrityError, transaction as db_atomic
from django.db.models import Count, F, Q
from django.utils import timezone
from django.utils.dateparse import parse_date

from .models import Promotion, PromoEvent, PromoImpression

# Which tally on the campaign row each answered card moves. The ledger and the
# counter are kept in step inside one transaction, so a counter is only ever a
# number a row can be shown to have produced.
COUNTER = {
    PromoEvent.Kind.CLICK: 'clicks',
    PromoEvent.Kind.PROFILE: 'profile_visits',
    PromoEvent.Kind.MESSAGE: 'messages',
}

# The showings a campaign needs before its answer rate is a rate worth ranking it
# on. Two readers and one tap is a coin flip, not a quality signal.
QUALITY_FLOOR = 10

# The numbers the platform shipped with, so a feed still scores the same way on a
# server where nobody has opened the desk and the settings row does not exist yet.
SHIPPED = {
    'algo_weight_like': 3,
    'algo_weight_comment': 4,
    'algo_weight_save': 5,
    'algo_weight_share': 6,
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
            'algo_weight_share', 'algo_weight_watch', 'algo_weight_follow',
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
    if promo.cities:
        out.append(_said_any(user.city, promo.cities))
    return out


def _said(theirs, asked):
    """Compare two place names the site may never have been told, or may have been
    told twice with different capitalisation. None means the person never said."""
    if not theirs:
        return None
    return str(theirs).lower() == str(asked).lower()


def _said_any(theirs, asked):
    """The same question, asked of a list: is their city one of the ones the payer named."""
    if not theirs:
        return None
    return str(theirs).lower() in {str(name).lower() for name in asked}


def audience_matches(promo, user):
    """The hard filters: what the person said about themselves, and the payer's band.

    An age the site was never told only clears a campaign that is willing to show
    itself to anybody old enough to have an account, because a payer who asked for
    thirties and got a fourteen-year-old is a complaint, not a rounding error. A
    country nobody typed is only a blank box, so it is not held against them — it
    just earns no audience points.

    Cities are held against them. Naming Kathmandu and Bhaktapur is a payer buying
    those two towns, so a person whose home town is blank, misspelled or elsewhere
    is somebody the coins were not meant for, and letting them through would be
    charging for reach the payer never asked to buy.
    """
    if not user.is_authenticated:
        return False
    if promo.owner_id == user.pk:
        return True
    if promo.cities and str(user.city or '').lower() not in {str(c).lower() for c in promo.cities}:
        return False
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
            from apps.posts.models import SharedPost
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
            shares = SharedPost.objects.filter(
                user=self.user, post__category=name, created_at__gte=self.since,
            ).count()
            self._categories[name] = (
                likes * self.weights['algo_weight_like']
                + comments * self.weights['algo_weight_comment']
                + saves * self.weights['algo_weight_save']
                + shares * self.weights['algo_weight_share']
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

        Someone who saved, sent out or argued under a post is not a spent lead — they
        are the likeliest reader the platform can find, so the paid card goes to them
        and the payer gets the engagement they bought rather than a stranger's scroll.
        """
        key = (promo.target_type, str(promo.target_id))
        if key not in self._touch:
            from apps.comments.models import Comment
            from apps.posts.models import SharedPost
            from apps.reactions.models import Reaction
            from apps.saved.models import SavedListing, SavedPost
            pk = int(key[1]) if key[1].isdigit() else None
            if pk is None:
                self._touch[key] = 0
            elif promo.target_type == Promotion.Target.LISTING:
                # An ad has no likes, comments or shares to earn, but the shelf a
                # person put it on is the same statement about the same thing.
                self._touch[key] = (
                    self.weights['algo_weight_save']
                    if SavedListing.objects.filter(user=self.user, listing_id=pk).exists() else 0
                )
            else:
                likes = Reaction.objects.filter(
                    user=self.user, target_type='post', target_id=key[1]).count()
                comments = Comment.objects.filter(author=self.user, post_id=pk).count()
                saves = SavedPost.objects.filter(user=self.user, post_id=pk).exists()
                shares = SharedPost.objects.filter(user=self.user, post_id=pk).exists()
                self._touch[key] = (
                    likes * self.weights['algo_weight_like']
                    + comments * self.weights['algo_weight_comment']
                    + (self.weights['algo_weight_save'] if saves else 0)
                    + (self.weights['algo_weight_share'] if shares else 0)
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


def ad_priors(promos, weights):
    """What each advertised post has already earned, in the console's own points.

    A reader with no history in this category leaves the platform nothing to order
    two campaigns by, and that tie used to fall to who paid the most — which says
    nothing about whether this stranger would stop scrolling at all. The ad's own
    record does: a post people liked, argued under and shared is one they would stop
    for again. Each of those spends the dial the desk already sets for it, so a
    stranger's queue is ordered by the advert rather than by an empty history.
    """
    ids = [int(promo.target_id) for promo in promos
           if promo.target_type == Promotion.Target.POST and str(promo.target_id or '').isdigit()]
    if not ids:
        return {}
    from apps.posts.models import Post
    by_post = {row['pk']: row for row in Post.objects.filter(pk__in=ids).values(
        'pk', 'like_count', 'comment_count', 'share_count', 'views')}
    out = {}
    for promo in promos:
        key = str(promo.target_id or '')
        row = by_post.get(int(key)) if key.isdigit() else None
        if row is None:
            continue
        out[promo.pk] = (
            row['like_count'] * weights['algo_weight_like']
            + row['comment_count'] * weights['algo_weight_comment']
            + row['share_count'] * weights['algo_weight_share']
            + row['views'] * weights['algo_weight_watch']
        )
    return out


# The campaign states that still hold the row they advertise: an order the desk has
# not read, a run that is spending, and one the payer stopped without closing. A
# refused or finished campaign asks nothing of the row, so it keeps nothing back.
HELD = (Promotion.Status.PENDING, Promotion.Status.ACTIVE, Promotion.Status.PAUSED)


def hold_on_target(target_id, target_type=Promotion.Target.POST):
    """The campaign that still owns this row, or nothing.

    The author's own delete doors ask this before they erase: a post that vanishes
    under an open campaign leaves a paid advert pointing at a row nobody can open,
    and a promise the payer paid reach for that can no longer be kept.
    """
    return Promotion.objects.filter(
        target_type=target_type, target_id=str(target_id), status__in=HELD,
    ).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now())).order_by('-created_at').first()


def live_campaigns(target_ids, target_type=Promotion.Target.POST):
    """Every campaign running right now against these rows, by advertised row id.

    A paid row does not stop being an advert because it reached the second page, the
    author's own profile or a link opened from outside the app. The payer bought the
    reach and the reader is owed the line over the row wherever the platform hands it
    to them, so this answers the disclosure question for any door that returns posts
    or listings. Metering stays where it was — a label spends no slot and writes no
    impression — so an organic read of a promoted row cannot inflate the reach a
    package promised.
    """
    keys = [str(pk) for pk in target_ids if pk]
    if not keys:
        return {}
    rows = Promotion.objects.filter(
        status=Promotion.Status.ACTIVE,
        target_type=target_type,
        target_id__in=keys,
    ).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now())).select_related('owner')
    return {str(promo.target_id): promo for promo in rows}


def promo_card(promo):
    """What a reader is told about the campaign behind the row they are looking at."""
    return {
        'id': promo.pk, 'owner': promo.owner_id, 'target_type': promo.target_type,
        'target_id': promo.target_id, 'category': promo.category,
        'age_min': promo.age_min, 'age_max': promo.age_max,
        'country': promo.country, 'cities': list(promo.cities or []), 'package': promo.package,
        'budget': promo.budget, 'status': promo.status,
        'impressions': promo.impressions, 'clicks': promo.clicks,
        'profile_visits': promo.profile_visits, 'messages': promo.messages,
        'edited_at': promo.edited_at,
        'created_at': promo.created_at, 'starts_at': promo.starts_at, 'ends_at': promo.ends_at,
    }


def mark_promoted(items, target_type=Promotion.Target.POST):
    """Say, row by row, which of these rows somebody is paying to put in front of people.

    Every door that hands out rows of one kind goes through here, because a disclosure
    that only exists on the feed is not a disclosure: the same advert read on the
    author's profile, on the saved shelf or from a shared link looked like an ordinary
    post, and the only copy wearing the label was the one the algorithm had placed. It
    cannot be a per-reader answer either — the anonymous first page is one cached
    response handed to every stranger — so what a paid row is made of is the same fact
    for everyone, and the metering stays inside the slot the feed actually spent.
    """
    live = live_campaigns([item.get('id') for item in items], target_type=target_type)
    for item in items:
        promo = live.get(str(item.get('id')))
        if promo is None:
            item['promoted'] = False
            continue
        item['promoted'] = True
        item['promo_id'] = promo.pk
        item['promo'] = promo_card(promo)


def place(cards, promos, organic, gap):
    """Interleave the paid cards into an ordinary page, and say which were placed.

    Every paid card waits `gap` ordinary rows before it takes its place, so a
    campaign sits in the middle of what the reader came for instead of over it.
    A card that never gets its gap is not shown, and is not written to the ledger
    either: the reach a payer is charged for is the reach a person actually saw.
    """
    step = max(1, gap)
    paid = list(zip(cards, promos))
    merged, since, shown = [], 0, []
    for item in organic:
        if paid and since >= step:
            card, promo = paid.pop(0)
            merged.append(card)
            shown.append(promo)
            since = 0
        merged.append(item)
        since += 1
    return merged, shown


def target_labels(promos):
    """One line per campaign naming the thing it advertises, keyed by (type, id).

    The wallet screens used to reach into this browser's own post cache for the title,
    and nothing on those screens ever filled that cache — so a cold load of a live,
    running campaign read "This post is not available" under a link to a post that
    existed. The server was handed the target when the order was placed; it can say
    what it is in two grouped reads instead of one per row.
    """
    posts = [int(promo.target_id) for promo in promos
             if promo.target_type == Promotion.Target.POST and str(promo.target_id or '').isdigit()]
    listings = [int(promo.target_id) for promo in promos
                if promo.target_type == Promotion.Target.LISTING and str(promo.target_id or '').isdigit()]
    out = {}
    if posts:
        from apps.posts.models import Post
        captions = dict(Post.Activity.choices)
        for row in Post.objects.filter(pk__in=posts).values('pk', 'text', 'activity'):
            text = (row['text'] or '').strip()
            out[(Promotion.Target.POST, str(row['pk']))] = (text[:70] or captions.get(row['activity'] or '', ''))
    if listings:
        from apps.marketplace.models import Listing
        for row in Listing.objects.filter(pk__in=listings).values('pk', 'title'):
            out[(Promotion.Target.LISTING, str(row['pk']))] = (row['title'] or '')[:70]
    return out


def serving(user, promos, today=None):
    """Write down what the page showed, and move the counter with it.

    Each showing of a campaign to a person takes the next seat of that pair's day
    (`PromoImpression.slot`), and the campaign's own tally only ever goes up when a
    row was really added — so the number a payer is charged against is the number
    the ledger can be read back to.

    The frame to the payer rides on `on_commit`, for the reason every other pulse in
    the platform does: a tab must never be told a number the transaction has not
    agreed to keep. A decision taken inside another transaction is therefore reported
    when the outer one lands, which is the right answer anyway.
    """
    if not promos or not user.is_authenticated:
        return 0
    day = today or timezone.now().date()
    told = []
    for promo in promos:
        try:
            with db_atomic.atomic():
                taken = PromoImpression.objects.filter(promotion=promo, viewer=user, day=day).count()
                PromoImpression.objects.create(promotion=promo, viewer=user, day=day, slot=taken + 1)
                Promotion.objects.filter(pk=promo.pk).update(impressions=F('impressions') + 1)
                db_atomic.on_commit(lambda pk=promo.pk: report_to_owner(pk))
                told.append(promo)
        except IntegrityError:
            # Another page of theirs took the same seat first; a duplicate is not reach.
            continue
    return len(told)


def answer(user, promo, kind, today=None):
    """Write down that this person answered a paid card, and move its tally.

    The same shape as `serving`, for the same reason: one row per person per campaign
    per day, and the number on the campaign rises only when a row was really added.
    An open rate the payer reads is therefore a rate between two things the ledger
    can show happened, and a script that posts at the door a thousand times moves
    nothing after the first answer.
    """
    if not user.is_authenticated or promo is None:
        return False
    day = today or timezone.now().date()
    column = COUNTER[kind]
    try:
        with db_atomic.atomic():
            PromoEvent.objects.create(promotion=promo, viewer=user, day=day, kind=kind)
            Promotion.objects.filter(pk=promo.pk).update(**{column: F(column) + 1})
            db_atomic.on_commit(lambda pk=promo.pk: report_to_owner(pk))
    except IntegrityError:
        return False
    return True


def credited(user, promo_id, other_id):
    """The campaign a chat was walked in from, if it still deserves the credit.

    A message is a result of an advert only when the advert is what put the reader
    there: the campaign still runs, the person on the other end of the thread is the
    one who paid for it, and the reach ledger says this reader was handed the card.
    Anything else is a conversation that was going to happen anyway, and billing it
    to a campaign would sell the payer a result their coins never bought.
    """
    key = str(promo_id or '')
    if not key.isdigit() or not user.is_authenticated:
        return None
    promo = Promotion.objects.filter(
        pk=int(key), owner_id=other_id, status=Promotion.Status.ACTIVE,
    ).first()
    if promo is None:
        return None
    if not PromoImpression.objects.filter(promotion=promo, viewer=user).exists():
        return None
    return promo


def _rate(numerator, denominator, places):
    """A division that says when it has no denominator.

    A rate only exists above a real number of things. `None` is the answer that
    reads correctly on an analytics screen — "not enough has happened yet" — where a
    zero would be read as a campaign nobody answered.
    """
    return round(numerator / denominator, places) if denominator else None


def quality_ranks():
    """Above, average or below the platform's own middle, by answer rate.

    An advert competing for the same scroll can only be ranked against the other
    adverts on this platform, which is the comparison actually available and the one
    that can be explained to a payer. The yard is the share of paid showings a card
    got somebody to answer, and the band around the middle stops a campaign that
    simply *is* the middle from reading as an outlier.
    """
    rows = list(Promotion.objects.filter(impressions__gte=QUALITY_FLOOR).values(
        'pk', 'impressions', 'clicks', 'profile_visits', 'messages'))
    if not rows:
        return {}
    rates = sorted(
        (row['clicks'] + row['profile_visits'] + row['messages']) / row['impressions'] for row in rows)
    mid = statistics.median(rates)
    out = {}
    for row in rows:
        rate = (row['clicks'] + row['profile_visits'] + row['messages']) / row['impressions']
        out[row['pk']] = ('above' if rate > mid * 1.15
                          else 'below' if rate < mid * 0.85 else 'average')
    return out


def campaign_figures(promos):
    """Every rate a campaign can be shown, from the two ledgers and nothing else.

    Each number is a division between things the platform wrote down — the reach
    ledger that sold the impression, the answer ledger that banked the tap, and the
    bill a seat actually took. So a payer reading cost per thousand or a conversion
    rate is reading their own campaign's arithmetic, and a campaign that has spent
    nothing, having never been approved, has no cost figures at all.
    """
    promos = list(promos)
    people = people_reached([promo.pk for promo in promos])
    ranks = quality_ranks()
    out = {}
    for promo in promos:
        answers = promo.clicks + promo.profile_visits + promo.messages
        # A run that no seat approved has a promise and no bill, so it has no cost
        # figures either. Printing "0 coins per thousand" for it would be a number
        # nobody paid.
        spent = float(promo.budget or 0) if promo.starts_at else 0.0
        out[promo.pk] = {
            # Reach is people, not showings: a package sells "up to 3,000 people".
            'reach': people.get(promo.pk, 0),
            # Everything a reached person did with the card, added once.
            'answers': answers,
            'cpm': _rate(spent * 1000, promo.impressions, 2) if spent else None,
            'cpr': _rate(spent, promo.messages, 1) if spent else None,
            # Of the readers who tapped the advert, how many went on to write.
            'conversion_rate': _rate(promo.messages * 100.0, promo.clicks, 1),
            'engagement_rate': _rate(answers * 100.0, promo.impressions, 1),
            'quality': ranks.get(promo.pk),
        }
    return out


def report_to_owner(promo_id):
    """Tell the payer what their campaign has added up to, in the ledger's own numbers.

    The counters rise through a queryset `update()`, which fires no signal and so no
    pulse, which left an analytics screen showing the figures as of the moment its tab
    was opened. One small frame per answered person is the cost of a live number, and
    it is bounded by the same once-a-day rule the ledger already keeps. The frame
    carries the totals rather than a delta so a repeated frame is harmless, and it
    carries the divided figures too — a payer watching a campaign sees the cost per
    thousand move with the showing that produced it, not only after a reload.
    """
    try:
        from apps.common import pulse
        promo = Promotion.objects.filter(pk=promo_id).first()
        if promo and promo.owner_id:
            tuned = campaign_figures([promo]).get(promo.pk, {})
            pulse.to_user(promo.owner_id, 'promo_metric', id=str(promo.pk),
                          impressions=promo.impressions, clicks=promo.clicks,
                          profile_visits=promo.profile_visits, messages=promo.messages,
                          reach=tuned.get('reach'), cpm=tuned.get('cpm'),
                          cpr=tuned.get('cpr'),
                          conversion_rate=tuned.get('conversion_rate'),
                          engagement_rate=tuned.get('engagement_rate'),
                          quality=tuned.get('quality'))
    except Exception:  # noqa: BLE001 - the number is already banked; the wire is a courtesy
        pass


def candidates(user, limit=2, target_type=None, tuned=None):
    """The campaigns this person may be shown right now, most likely first.

    Two tiers, because a payer buys both ends of the funnel. The named tier is the
    audience the platform can point at: the people who liked, commented, saved,
    shared or watched this kind of post lately, and the ones who already follow the
    payer.
    Behind it sits everyone inside the audience the payer bought who has no history
    to score — and they used to be dropped, which left a campaign selling only to
    people who had already bought. They are served now, ordered by what the ad has
    earned rather than by the wallet that bought it, so the reach a package promises
    is reach the platform actually delivers.
    """
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
    # The daily cap counts showings, not campaigns: someone who met two campaigns
    # three times each has spent six of the day's seats. A campaign they already saw
    # stays eligible until its own repeat dial is spent for today.
    handed = PromoImpression.objects.filter(viewer=user, day=timezone.now().date())
    room = max(0, dial['daily'] - handed.count())
    shelf = _shelf()
    promised = {promo.pk: int((shelf.get(str(promo.package or '')) or {}).get('reach_max') or 0)
                for promo in promos}
    reached = people_reached([pk for pk, cap in promised.items() if cap]) if any(promised.values()) else {}
    scores = Affinity(user, dial['weights'], dial['target'])
    # One grouped count for every campaign on the shelf. This used to be one
    # COUNT per campaign, which made the repeat dial the most expensive part of
    # every authenticated feed page.
    shown = {}
    if dial['repeat']:
        for row in handed.filter(
            promotion_id__in=[promo.pk for promo in promos],
        ).values('promotion_id').annotate(total=Count('id')):
            shown[row['promotion_id']] = row['total']
    priors = ad_priors(promos, dial['weights'])
    named, strangers = [], []
    for promo in promos:
        if dial['repeat'] and shown.get(promo.pk, 0) >= dial['repeat']:
            continue
        if promised[promo.pk] and reached.get(promo.pk, 0) >= promised[promo.pk]:
            continue
        if not audience_matches(promo, user):
            continue
        score = scores.score(promo, user)
        prior = priors.get(promo.pk, 0)
        # The same money and the same wait still break a tie, so one campaign
        # cannot outwait the rest of the shelf.
        wallet = (-float(promo.budget or 0), promo.created_at)
        if promo.owner_id == user.pk or score >= dial['floor']:
            named.append(((-score,) + wallet, promo))
        else:
            strangers.append(((-prior,) + wallet + (-score,), promo))
    # Equally likely people, equally willing payers: the bigger buy leads, and the
    # older campaign leads inside that. A named reader never waits behind a stranger.
    for tier in (named, strangers):
        tier.sort(key=lambda row: row[0])
    return [promo for _, promo in (named + strangers)][:max(0, min(limit, room))]


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
