"""Every door that writes a password asks the same four questions here.

Signup, a member's own reset, the first password at the console door and a staff
recovery all used to carry their own rules, which is how one door came to refuse
a word another one accepted — and how a reset could land back on the password the
account already had and still be called a change.
"""

from django.contrib.auth.hashers import check_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError

# Five words is enough to break the loop a reset invites — new one, old one, new
# one — without turning a person's own history into a wall they cannot leave.
KEEP = 5
# Django's own floor is eight. A staff seat opens the whole platform, so both
# doors ask for more than the default, and the rule is stated here once rather
# than guessed at by two forms.
MIN_LENGTH = 10


def strength(password, user=None):
    """The sentence to show when a word is not fit to be a password, or ''."""
    text = str(password or '')
    if len(text) < MIN_LENGTH:
        return f'Use at least {MIN_LENGTH} characters.'
    if not (any(char.isalpha() for char in text) and any(char.isdigit() for char in text)):
        return 'Use at least one letter and one number.'
    if len(set(text)) < 4:
        return 'That is too few different characters.'
    try:
        validate_password(text, user)
    except DjangoValidationError as exc:
        return ' '.join(exc.messages)
    return ''


def reused(user, password):
    """True when this word is one the account has already stood on."""
    from .models import PasswordHistory

    if not password:
        return False
    stored = PasswordHistory.objects.filter(user=user).values_list('password_hash', flat=True)[:KEEP]
    return any(check_password(password, item) for item in stored)


def remember(user):
    """Store the hash the account now stands on, and keep only the last few.

    Called after the row is written, so what is stored is the hash the account
    itself carries — nothing here ever sees the word.
    """
    from .models import PasswordHistory

    if not user.has_usable_password():
        return
    PasswordHistory.objects.create(user=user, password_hash=user.password)
    stale = list(PasswordHistory.objects.filter(user=user).values_list('pk', flat=True)[KEEP:])
    if stale:
        PasswordHistory.objects.filter(pk__in=stale).delete()


def refusal(password, user):
    """Why this password may not be written for this account, or '' if it may.

    Checks the live password before the history: a row whose first password was
    never recorded still must not be allowed to "change" to the word it holds.
    """
    bad = strength(password, user)
    if bad:
        return bad
    if user.check_password(password):
        return 'That is the password this account already uses. Choose a different one.'
    if reused(user, password):
        return f'You have used that password on this account before. Choose one you have not used recently.'
    return ''
