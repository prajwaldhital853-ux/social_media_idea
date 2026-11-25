"""Make the ten reports the 6.3 walkthrough has to decide, and nothing else.

`admin/qa/console.mjs` proves the review queue, the takedown shelf, the policy
lists and the public notices end to end, so it needs a pile it owns: one live
post carrying three reports and a blocked word in its caption, one post the report
counter has already hidden, one live post with a paid campaign running on it, one
listing, one comment and one report against the account itself. Every row belongs
to `qa_reviewer` or to the three `qa_rep_*` reporters, is labelled as a console
sample in its own text, and is posted followers-only so it never lands in the
demo feed a person else is screenshotting.

The last report, one live post, one reporter, is left open on purpose. It is the
one the Moderator seat decides after the Client has handed it the pen back.

Running it again wipes those rows first, so the queue always shows the same
counts. No other account, post, listing or report is read or written.

    backend/.venv/Scripts/python.exe admin/qa/review_seed.py
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
from apps.marketplace.models import Listing  # noqa: E402
from apps.moderation.models import Report  # noqa: E402
from apps.posts.models import Post  # noqa: E402
from apps.promotions.models import Promotion  # noqa: E402
from apps.wallet.models import Wallet  # noqa: E402

from apps.adminpanel.models import PolicyCategory, PolicyTerm, PublicNotice  # noqa: E402

PASSWORD = 'exposing-demo-1'
AUTHOR = 'qa_reviewer'
REPORTERS = ('qa_rep_1', 'qa_rep_2', 'qa_rep_3')


def account(username, **profile):
    user = User.objects.filter(username=username).first()
    if user is None:
        user = User.objects.create_user(username=username, password=PASSWORD, email=f'{username}@example.test')
    if profile and hasattr(user, 'profile'):
        for field, value in profile.items():
            setattr(user.profile, field, value)
        user.profile.save()
    return user


def reported(target, kind, rows):
    for username, reason, details in rows:
        Report.objects.create(
            reporter=User.objects.get(username=username), target_type=kind,
            target_id=str(target.pk), reason=reason, details=details,
        )


def main():
    now = timezone.now()
    author = account(AUTHOR, avatar_url='https://picsum.photos/seed/qa-reviewer/200/200')
    for username in REPORTERS:
        account(username)

    # Wipe only what this file made, so a re-run gives the queue the same shape.
    reporters = User.objects.filter(username__in=REPORTERS)
    Report.objects.filter(reporter__in=reporters).delete()
    PublicNotice.objects.filter(about=author).delete()
    Promotion.objects.filter(owner=author).delete()
    Comment.objects.filter(author=author).delete()
    Listing.objects.filter(seller=author).delete()
    Post.objects.filter(author=author).delete()
    # The walkthrough writes these three itself, so they have to start out absent.
    PolicyTerm.objects.filter(text__in=('gunpowder', 'firearms')).delete()
    PolicyCategory.objects.filter(name__iexact='Bicycles QA').delete()

    # Followers-only: the demo feed a second agent is looking at does not carry these.
    first = Post.objects.create(
        author=author, status=Post.Status.LIVE, audience=Post.Audience.FOLLOWERS,
        text='console QA sample, is anyone selling gunpowder in Thamel this week? paid for buygunpowder yesterday, DM me',
    )
    hidden = Post.objects.create(
        author=author, status=Post.Status.HIDDEN, audience=Post.Audience.FOLLOWERS,
        text='console QA sample, the report counter stopped this one before a person read it',
    )
    promoted = Post.objects.create(
        author=author, status=Post.Status.LIVE, audience=Post.Audience.FOLLOWERS,
        text='console QA sample, bicycle for sale, this post has a paid campaign running on it',
    )
    # The walkthrough leaves this one open on purpose: it is the report the
    # Moderator seat decides, which is how the audit row proves who held the pen.
    spare = Post.objects.create(
        author=author, status=Post.Status.LIVE, audience=Post.Audience.FOLLOWERS,
        text='console QA sample, this one is left for the moderator seat to decide',
    )

    Comment.objects.create(
        post=first, author=author, text='console QA sample, ignore the gunpowder caption above',
    )
    Listing.objects.create(
        seller=author, title='console QA sample, pressure cooker 5L, ignore',
        description='A walkthrough listing for the marketplace review queue. Not a real thing for sale.',
        price=Decimal('4500.00'), category='Home', condition='Good', location='Kathmandu',
        image_url='https://picsum.photos/seed/qa-listing/1200/900',
    )

    reported(first, 'post', (
        ('qa_rep_1', 'spam', 'posted the same caption three times'),
        ('qa_rep_2', 'spam', ''),
        ('qa_rep_3', 'harassment', 'targeting me in the comments'),
    ))
    reported(hidden, 'post', (
        ('qa_rep_1', 'spam', ''),
        ('qa_rep_2', 'misinformation', ''),
    ))
    reported(promoted, 'post', (('qa_rep_1', 'scam', 'asking for payment outside the site'),))
    reported(spare, 'post', (('qa_rep_2', 'other', 'left open for the moderator seat'),))
    reported(Listing.objects.get(seller=author), 'listing', (('qa_rep_2', 'scam', ''),))
    reported(Comment.objects.get(author=author), 'comment', (('qa_rep_3', 'harassment', ''),))
    Report.objects.create(reporter=User.objects.get(username='qa_rep_1'), target_type='user',
                          target_id=str(author.pk), reason='impersonation', details='uses my photos')

    promo = Promotion.objects.create(
        owner=author, target_type='post', target_id=str(promoted.pk), package='week',
        budget=Decimal('900.00'), status=Promotion.Status.ACTIVE, category='Bikes',
    )
    # Ten days spent, twenty to run: stopping it now owes 600 of the 900 back.
    Promotion.objects.filter(pk=promo.pk).update(created_at=now - timedelta(days=10),
                                                 ends_at=now + timedelta(days=20))
    wallet, _ = Wallet.objects.get_or_create(user=author)
    Wallet.objects.filter(pk=wallet.pk).update(balance=Decimal('500.00'))

    print(f'{AUTHOR} owns 4 posts, 1 comment, 1 listing and 1 paid campaign.')
    print(f'{Report.objects.filter(reporter__in=reporters).count()} open reports from {", ".join(REPORTERS)}.')
    print(f'campaign {promo.pk} on post {promoted.pk}: 900 coins, ends in 20 days -> 600 owed back if removed.')
    print(f'post {spare.pk} is the one left for the Moderator seat; every row is searched with q=qa_rep.')


if __name__ == '__main__':
    main()
