"""Put the six accounts the 6.4 walkthrough needs where it expects to find them.

`admin/qa/console.mjs` proves user management end to end, so it needs a directory
with something distinct in each of its corners: a Google sign-up it can filter to,
an unverified account to hand the tick, an account sitting under the exact number
of reporters that flags it plus a sign-in lockout to clear, one to suspend for
days, one to suspend for good, one whose wallet must block a deletion and one with
nothing owed so the deletion goes through.

Every row is a `qa_` account created here, is followers-only where it has content,
and is labelled as a console sample in its own text, so the demo database a second
agent is looking at keeps its shape. Running it again resets those six accounts to
their starting state, including recreating the one the last run deleted, and
touches nothing else.

    backend/.venv/Scripts/python.exe admin/qa/people_seed.py
"""

import os
import sys
from decimal import Decimal

import django

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
sys.path.insert(0, BACKEND)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')
django.setup()

from datetime import timedelta  # noqa: E402

from django.utils import timezone  # noqa: E402

from apps.accounts.models import User  # noqa: E402
from apps.comments.models import Comment  # noqa: E402
from apps.moderation.models import Report  # noqa: E402
from apps.posts.models import Post  # noqa: E402
from apps.promotions.models import Promotion  # noqa: E402
from apps.wallet.models import Wallet  # noqa: E402

from apps.adminpanel.models import PublicNotice  # noqa: E402

PASSWORD = 'exposing-demo-1'
MEMBER = 'qa_member'
FLAGGED = 'qa_flagged'
BARRED = 'qa_barred'
FOREVER = 'qa_forever'
WALLETED = 'qa_walleted'
GONER = 'qa_goner'
# The pile on `qa_flagged` is filed by its own three accounts, deliberately NOT
# the `qa_rep_*` reporters the 6.3 walkthrough searches for. That queue is reached
# by a search on the reporter's name, so sharing reporters would quietly add a
# fourth thing to decide to a screen that asserts exactly how many it holds.
FLAGGERS = ('qa_flag_1', 'qa_flag_2', 'qa_flag_3')
OWNED = (MEMBER, FLAGGED, BARRED, FOREVER, WALLETED, GONER)
# What only this file's reports carry, so a re-run wipes its own pile and leaves
# the 6.3 walkthrough's reports standing.
MARK = 'console QA sample - user directory'


def account(username, provider='email', **fields):
    """The account, created if a previous walkthrough deleted it, in its start state."""
    user = User.objects.filter(username=username).first()
    if user is None:
        user = User.objects.create_user(username=username, password=PASSWORD,
                                        email=f'{username}@example.test')
    user.provider = provider
    # Back to "nobody has acted on this account yet", whichever verbs last run used.
    user.suspended_until = None
    user.suspend_reason = ''
    user.locked_until = None
    user.failed_attempts = 0
    user.is_active = True
    for key, value in fields.items():
        setattr(user, key, value)
    user.save()
    profile = getattr(user, 'profile', None)
    if profile is not None:
        profile.verified = False
        profile.notify_email = True
        profile.display_name = profile.display_name or username.replace('qa_', 'QA ')
        profile.save(update_fields=['verified', 'notify_email', 'display_name'])
    return user


def purse(user, amount):
    wallet, _ = Wallet.objects.get_or_create(user=user)
    Wallet.objects.filter(pk=wallet.pk).update(balance=Decimal(amount))
    return wallet


def main():
    now = timezone.now()
    for username in FLAGGERS:
        account(username)

    member = account(MEMBER, provider='google')
    member.profile.display_name = 'QA Sample Member'
    member.profile.save(update_fields=['display_name'])
    flagged = account(FLAGGED)
    barred = account(BARRED)
    forever = account(FOREVER)
    walleted = account(WALLETED, provider='facebook')
    goner = account(GONER)

    # The pile is the one the report counter itself would call a flag: three
    # distinct reporters on one live post. Only reports carrying this file's own
    # label go first, so a re-run rebuilds exactly what it made and leaves the 6.3
    # walkthrough's reports, and every real report, standing.
    owned = User.objects.filter(username__in=OWNED)
    Report.objects.filter(details__startswith=MARK).delete()
    # A public notice points at content by id, so the one the last run wrote on a
    # post it then deleted would still be standing on the notice desk.
    PublicNotice.objects.filter(about__in=owned).delete()
    Comment.objects.filter(author__in=owned).delete()
    Post.objects.filter(author__in=owned).delete()
    piled = Post.objects.create(
        author=flagged, status=Post.Status.LIVE, audience=Post.Audience.FOLLOWERS,
        text='console QA sample, three people reported this post and the counter flagged the account',
    )
    for username, reason in zip(FLAGGERS, ('spam', 'spam', 'harassment')):
        Report.objects.create(
            reporter=User.objects.get(username=username), target_type='post',
            target_id=str(piled.pk), reason=reason,
            details=f'{MARK}, filed by the user-directory walkthrough',
        )
    Report.objects.create(
        reporter=User.objects.get(username=FLAGGERS[0]), target_type='user',
        target_id=str(flagged.pk), reason='spam', details=f'{MARK}, on the account itself',
    )
    # The account the run deletes has to have something of its own to lose, so the
    # sentence the screen says about a deletion names real numbers rather than zeros.
    leaving = Post.objects.create(
        author=goner, status=Post.Status.LIVE, audience=Post.Audience.FOLLOWERS,
        text='console QA sample, this post goes with the account that is deleted by the run',
    )
    Comment.objects.create(post=leaving, author=goner,
                           text='console QA sample, and so does this comment of theirs')
    # A lockout the "clear spam flags" verb is expected to undo, and the one account
    # that turned warning emails off, so the muted path is walkable too. The window
    # is hours wide, not minutes: the walkthrough reaches this step after six others.
    flagged.failed_attempts = 6
    flagged.locked_until = now + timedelta(hours=6)
    flagged.save(update_fields=['failed_attempts', 'locked_until'])
    flagged.profile.notify_email = False
    flagged.profile.save(update_fields=['notify_email'])

    Promotion.objects.filter(owner__in=User.objects.filter(username__in=OWNED)).delete()
    for user, balance in ((barred, '0.00'), (forever, '0.00'), (member, '0.00'),
                          (flagged, '0.00'), (goner, '0.00'), (walleted, '250.00')):
        purse(user, balance)

    print(f'{MEMBER} signed up with Google, {WALLETED} with Facebook, the rest by email.')
    print(f'{FLAGGED}: 3 reporters on post {piled.pk} + 1 on the account, locked out until '
          f'{flagged.locked_until:%H:%M}.')
    print(f'{BARRED} and {FOREVER} start unsuspended; {GONER} has one post and one comment '
          'and is deleted by the run.')
    print(f'{WALLETED} holds 250.00 coins, which is what makes the deletion refuse.')


if __name__ == '__main__':
    main()
