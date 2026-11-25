"""The two lists a moderator decides against: what may not be said, and what may not be sold.

Enforcing these at write time belongs to the site's own post and listing views,
which this console does not edit. What lives here is the vocabulary itself, read
by the review queue, which marks the reported text with whatever on this list it
contains, so the decision is made against the platform's stated rules rather than
against whatever the moderator happens to remember.
"""

from .models import PolicyCategory, PolicyTerm


def normalize(text):
    """One case, no padding: `Gun Powder` and `gunpowder ` are the same entry."""
    return ' '.join(str(text or '').split()).lower()


def words():
    """The active blocked words, cheapest first for a scan of a short string."""
    return list(PolicyTerm.objects.filter(kind=PolicyTerm.Kind.WORD, is_active=True).values_list('text', flat=True))


def items():
    return list(PolicyTerm.objects.filter(kind=PolicyTerm.Kind.ITEM, is_active=True).values_list('text', flat=True))


def scan(text):
    """Which blocked words appear in this text. Substring, case-insensitive, no regex.

    Deliberately not a word-boundary match: `buygunspowder` has to count, because
    that is exactly what a person writing around a filter types.
    """
    haystack = normalize(text)
    if not haystack:
        return []
    return [term for term in words() if term and term in haystack]


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
