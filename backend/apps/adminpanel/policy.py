"""The two lists a moderator decides against: what may not be said, what may not be sold.

Two doors read this vocabulary. The review queue marks the text a person reported
with whatever on this list it contains, so a decision is made against the platform's
stated rules rather than against what the moderator happens to remember. The post and
comment doors ask the same list *before* they save anything, so a sentence carrying a
blocked word is refused on the way in and its author is told which word stopped it --
nothing is written, so there is nothing later to find in the feed.
"""

from django.core.cache import cache
from rest_framework.response import Response

from .models import PolicyCategory, PolicyTerm

# One bell notice per word, not one per attempt: twenty tries at the same filter are
# one decision for the desk, and a tray full of the same word is a tray nobody opens.
# The audit log, which is the archive rather than the queue, does record every attempt.
ALERT_EVERY = 3600


def normalize(text):
    """One case, no padding: `Gun Powder` and `gunpowder ` are the same entry."""
    return ' '.join(str(text or '').split()).lower()


def words():
    """The active blocked words, cheapest first for a scan of a short string."""
    return list(PolicyTerm.objects.filter(kind=PolicyTerm.Kind.WORD, is_active=True).values_list('text', flat=True))


def items():
    return list(PolicyTerm.objects.filter(kind=PolicyTerm.Kind.ITEM, is_active=True).values_list('text', flat=True))


def terms_for(kind):
    """What a decision about this kind of thing is read against.

    A listing is judged against the prohibited items too: that list is the
    vocabulary the marketplace desk is written in, and nothing else on the
    platform reads it, so an item added in the console would otherwise sit
    there unquoted.
    """
    return words() + (items() if kind == 'listing' else [])


def scan(text, terms=None):
    """Which blocked terms appear in this text. Substring, case-insensitive, no regex.

    Deliberately not a word-boundary match: `buygunspowder` has to count, because
    that is exactly what a person writing around a filter types.
    """
    haystack = normalize(text)
    if not haystack:
        return []
    return [term for term in (terms if terms is not None else words()) if term and term in haystack]


def check(request, kind):
    """None when this write may be saved, otherwise the answer to hand back instead.

    The same shape the console's own gate uses, so a member-facing door reads it in
    one line. Every text field a write carries is scanned — a post or comment says
    `text`, a listing says `title` and `description`, and a listing is also read
    against the prohibited-items list, because that list is the vocabulary the
    marketplace is sold under. The blocked sentence never reaches the database: its
    author gets the words that stopped it in a `detail` their app can put on the
    screen it came from, and the same words as a `blocked` list so the composer can
    paint them where they sit. The audit log gets one row per attempt, the bell one
    per word.
    """
    data = request.data if isinstance(request.data, dict) else {}
    terms = terms_for(kind)
    hits = []
    for field in ('text', 'title', 'description'):
        for hit in scan(data.get(field), terms):
            if hit not in hits:
                hits.append(hit)
    if not hits:
        return None
    from . import bell, journal

    who = getattr(request.user, 'username', '') or 'an anonymous seat'
    named = ', '.join(f'"{word}"' for word in hits[:3])
    if len(hits) > 3:
        named += f' and {len(hits) - 3} more'
    journal.record(None, 'blocked_word', f'{kind} by @{who}', f'{named}: {_excerpt(data.get("text") or data.get("title"))}')
    # The tray wakes once per word, because twenty tries at one filter are one
    # decision for the desk; the row above still carries every single attempt.
    if cache.add(f'blocked-word-bell:{kind}:{hits[0]}', 1, ALERT_EVERY):
        bell.announce(
            'alert', f'@{who} was stopped by blocked wording on a {kind}: {named}',
            '/policy', 'blocked_words',
        )
    return Response({
        'detail': f'This contains wording the platform has blocked: {named}. Take it out and try again.',
        'blocked': hits,
    }, status=400)


def _excerpt(text, length=140):
    """The attempt, on one line, for the log rather than for the tray."""
    return ' '.join(str(text or '').split())[:length]


def categories(active_only=True):
    rows = PolicyCategory.objects.all()
    if active_only:
        rows = rows.filter(is_active=True)
    return list(rows)


def category_names(active_only=True):
    return [row.name for row in categories(active_only)]


def row_term(term):
    return {
        'id': term.pk,
        'kind': term.kind,
        'text': term.text,
        'note': term.note,
        'is_active': term.is_active,
        'created_at': term.created_at,
        'created_by': term.created_by.username if term.created_by else None,
    }


def row_category(category, listings=None):
    return {
        'id': category.pk,
        'name': category.name,
        'is_active': category.is_active,
        'sort_order': category.sort_order,
        # How many live listings actually sit under this label, so switching one
        # off shows what that costs the marketplace rather than guessing.
        'listings': listings,
    }
