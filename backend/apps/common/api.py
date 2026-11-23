"""Shared helpers that let one API round-trip render a screen without N+1 fetches."""

from django.db.models import Case, Count, Exists, F, IntegerField, OuterRef, Q, Value, When, Window
from django.db.models.functions import RowNumber

from apps.follows.models import Follow
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


REACTOR_PREVIEW = 3

REACTOR_FIELDS = (
    'target_id', 'kind', 'user_id', 'bucket', 'created_at', 'pk',
    'user__username', 'user__profile__display_name', 'user__first_name', 'user__last_name',
)


def reactor_order(request, qs):
    """You first, then the people you already follow, then everyone else.

    A card prints names in the order the reader cares about them and the sheet
    behind it walks that same line, so both read from one ordering.
    """
    user = getattr(request, 'user', None)
    me = user.pk if user is not None and user.is_authenticated else None
    return qs.annotate(
        followed_by_me=Exists(
            Follow.objects.filter(
                follower_id=me, followee=OuterRef('user_id'), status=Follow.Status.ACCEPTED
            )
        ),
    ).annotate(
        bucket=Case(
            When(user_id=me, then=Value(0)),
            When(followed_by_me=True, then=Value(1)),
            default=Value(2),
            output_field=IntegerField(),
        ),
    ).order_by('bucket', F('created_at').desc(), F('pk').desc())


def _reactor_name(row):
    full_name = ' '.join(part for part in (row['user__first_name'], row['user__last_name']) if part)
    return row['user__profile__display_name'] or full_name or row['user__username']


def _reactor_rank():
    return Window(
        expression=RowNumber(),
        partition_by=F('target_id'),
        order_by=[F('bucket').asc(), F('created_at').desc(), F('pk').desc()],
    )


def reactor_rows(request, target_type, ids, limit=REACTOR_PREVIEW):
    """{target_id: [row, ...]} holding each target's first `limit` reactors."""
    if not ids:
        return {}
    qs = reactor_order(request, Reaction.objects.filter(target_type=target_type, target_id__in=[str(i) for i in ids]))
    grouped: dict = {}
    for row in qs.annotate(rank=_reactor_rank()).filter(rank__lte=limit).values(*REACTOR_FIELDS):
        grouped.setdefault(row['target_id'], []).append(row)
    return grouped


def _sort_key(row):
    return (row['bucket'], -row['created_at'].timestamp(), -row['pk'])


def _reactor_person(row, me_id):
    return {
        'id': row['user_id'],
        'name': _reactor_name(row),
        'kind': row['kind'],
        'me': row['user_id'] == me_id,
    }


def post_page_people(request, post_ids, media_ids):
    """Up to three names per post — its own reactions and its media's together.

    Two bounded queries rather than one that works out which post a media row
    belongs to: a group's first three always contains the first three of anything
    nested inside it, so merging the two short lists answers exactly.

    One person is one name, even when they liked the post and its photo both:
    a card that read "You, You and 104 others" would be wrong in front of the
    reader, and the list behind the row already counts them once.
    """
    user = getattr(request, 'user', None)
    me_id = user.pk if user is not None and user.is_authenticated else None
    own = reactor_rows(request, 'post', post_ids)
    media = reactor_rows(request, 'media', media_ids)
    candidates: dict = {}
    for target, rows in own.items():
        candidates.setdefault(str(target), []).extend(rows)
    for target, rows in media.items():
        candidates.setdefault(str(target).split('#m', 1)[0], []).extend(rows)
    out = {}
    for post_id, rows in candidates.items():
        rows.sort(key=_sort_key)
        people = []
        seen = set()
        for row in rows:
            if row['user_id'] in seen:
                continue
            seen.add(row['user_id'])
            people.append(_reactor_person(row, me_id))
            if len(people) == REACTOR_PREVIEW:
                break
        out[str(post_id)] = people
    return out


def reactions_of_target(target_type, target_id):
    """Every reaction row a post's summary counts — its own and its media's.

    The card adds the photo likes to the post like, so the list behind it has to
    reach the same rows or the two numbers disagree in front of the reader.
    """
    if target_type != 'post' or not str(target_id).isdigit():
        return Reaction.objects.filter(target_type=target_type, target_id=str(target_id))
    media_ids = [
        f'{post_id}#m{position}'
        for post_id, position in PostMedia.objects.filter(post_id=int(target_id)).values_list('post_id', 'position')
    ]
    qs = Reaction.objects.filter(Q(target_type='post', target_id=str(target_id)))
    if media_ids:
        qs |= Reaction.objects.filter(target_type='media', target_id__in=media_ids)
    return qs


def reactor_page(request, qs, kind=None, cursor=None, size=12):
    """One page of the people who reacted, walking (bucket, newest, id).

    Someone who liked the post and loved its photo is one name here, not two:
    the second window keeps only their earliest matching reaction, so a person
    cannot take two seats in a list the card above it counts once.
    """
    if kind:
        qs = qs.filter(kind=kind)
    qs = reactor_order(request, qs).annotate(
        person_rank=Window(
            expression=RowNumber(),
            partition_by=F('user_id'),
            order_by=[F('created_at').asc(), F('pk').asc()],
        ),
    ).filter(person_rank=1).select_related('user', 'user__profile')
    if cursor:
        bucket, stamp, pk = cursor
        qs = qs.filter(
            Q(bucket__gt=bucket)
            | Q(bucket=bucket, created_at__lt=stamp)
            | Q(bucket=bucket, created_at=stamp, pk__lt=pk)
        )
    return list(qs[:size + 1])


def post_page_reactions(request, posts):
    """My reaction, the page's per-kind aggregates and its first names — one call.

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
        'people': post_page_people(request, post_ids, media_ids),
    }


def notice_map(kind, ids, request=None):
    """The notices a seat has left standing on a page of content, for this reader.

    Almost nothing carries a notice, so a page of forty posts must not spend
    forty queries to find out it has none. The console writes these rows; this is
    the only way a member reads one, and it reads the newest sentence first.

    A row aimed at one account is read by that account and by nobody else — not
    because the sentence is secret, but because it is a note to one person about
    their own content, and a stranger scrolling the feed has nothing to take from
    it. Only the reader's own view of their profile or their post shows it.
    """
    from django.db.models import Q

    from apps.adminpanel.models import PublicNotice

    keys = [str(pk) for pk in ids if pk not in (None, '')]
    if not keys:
        return {}
    reader = getattr(request, 'user', None)
    pk = getattr(reader, 'pk', None)
    gate = Q(audience=PublicNotice.Audience.PUBLIC)
    if pk:
        gate |= Q(audience=PublicNotice.Audience.PRIVATE, about_id=pk)
    grouped = {}
    rows = (PublicNotice.objects
            .filter(target_type=kind, target_id__in=keys, is_live=True)
            .filter(gate)
            .select_related('actor')
            .order_by('-created_at'))
    for row in rows:
        grouped.setdefault(row.target_id, []).append({
            'id': row.pk,
            'text': row.text,
            'reason': row.reason,
            'by': row.actor.username if row.actor else 'staff',
            'at': row.created_at,
            'private': row.audience == PublicNotice.Audience.PRIVATE,
        })
    return grouped
