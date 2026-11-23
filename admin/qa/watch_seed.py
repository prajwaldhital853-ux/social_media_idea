"""Put the safety desk, the alerts desk and the flagged pile where 6.9 is judged on them.

The other seeds hand their screens rows to list. This one hands its screens a
*story*, because three of them are only interesting when something is wrong:

- the pile needs to be split by what the platform actually does about it. A post
  under four reporters has already been pulled out of the feed; a comment under
  three has not, because auto-hide has never looked at comments; a listing under
  three has not either; and a report whose target was deleted still counts, even
  though there is nothing left to rule on. Four states, four different sentences,
  and a seat has to be able to tell them apart without opening the database.
- the four outside reporters each get a different answer — one healthy, one gone
  quiet, one counting trouble, one nobody ever wired in — because "the backup did
  not run", "the backup job has stopped talking" and "nothing watches the backups"
  are three separate things to be told, and a seed that stamped all four the same
  way would let the alerts desk pass while saying nothing true.
- the audit log is left *empty* of its newest families on purpose. The screen's job
  is to tell a zero from a gap, so the walkthrough reads the gap list before it
  turns a single knob, then reads it again afterwards and watches it shrink.

Everything here is backdated five days. A report filed today would land on the
first page of the 6.3 queue, which asserts exactly how many cases it holds, and an
auto-hide stamped today would raise the wave alert against a threshold nobody set.

    backend/.venv/Scripts/python.exe admin/qa/watch_seed.py
"""

import os
import sys
from datetime import timedelta
from decimal import Decimal

import django

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
sys.path.insert(0, BACKEND)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')
django.setup()

from django.utils import timezone  # noqa: E402

from apps.accounts.models import User  # noqa: E402
from apps.comments.models import Comment  # noqa: E402
from apps.marketplace.models import Listing  # noqa: E402
from apps.moderation.models import AuditLog, Report  # noqa: E402
from apps.posts.models import Post  # noqa: E402

from apps.adminpanel import alerts  # noqa: E402
from apps.adminpanel.models import AdminAlert, AdminPulse, PolicyTerm  # noqa: E402

PASSWORD = 'exposing-demo-1'
MAIL = 'watch.test'
MARK = 'console QA sample - safety watch'
OWNER = 'sita'

HOST = 'qa_peek_host'
PEEKERS = ('qa_peek_a', 'qa_peek_b', 'qa_peek_c', 'qa_peek_d')
OWNED = (HOST,) + PEEKERS
# Five days back: past every "in the last hour" and "today" window in the alert
# scan, and past the first page of every queue the earlier walkthroughs count.
AGE = timedelta(days=5)
# A post that no longer exists, so the pile has a row with nothing to rule on.
GONE_POST = 10 ** 9

LINKS = (
    ('pay-secure-verify.example', 'A payment page that copies the bank details off our own form.', True),
    ('watch-live-stream.example', 'Named in four scam listings in the same week.', True),
    ('free-coins-now.example', 'Shut down by its host; kept so the old posts still get caught.', False),
)


def account(username):
    user = User.objects.filter(username=username).first()
    if user is None:
        user = User.objects.create_user(username=username, password=PASSWORD, email=f'{username}@{MAIL}')
    user.email = f'{username}@{MAIL}'
    user.is_active = True
    user.suspended_until = None
    user.save()
    profile = getattr(user, 'profile', None)
    if profile is not None:
        profile.display_name = profile.display_name or username.replace('qa_peek_', 'QA Watch ')
        profile.save(update_fields=['display_name'])
    return user


def filed(target, kind, reason, reporter, when):
    """An open report, stamped backwards, with this file's own label on it."""
    row = Report.objects.create(
        reporter=reporter, target_type=kind, target_id=str(target), reason=reason,
        details=f'{MARK} — filed against the {kind} by the safety watch seed',
    )
    Report.objects.filter(pk=row.pk).update(created_at=when)
    return row


def main():
    now = timezone.now()
    host = account(HOST)
    actor = User.objects.filter(username=OWNER).first() or host
    strangers = [account(name) for name in PEEKERS]

    # Own rows first, so a re-run leaves the 6.3 queue and the user directory alone.
    Report.objects.filter(details__startswith=MARK).delete()
    AuditLog.objects.filter(detail__startswith=MARK).delete()
    Listing.objects.filter(seller__in=[host]).delete()
    mine = Post.objects.filter(author=host)
    Comment.objects.filter(post__in=mine).delete()
    mine.delete()
    PolicyTerm.objects.filter(kind=PolicyTerm.Kind.LINK,
                              text__in=[text for text, _note, _a in LINKS]).delete()
    AdminPulse.objects.all().delete()
    AdminAlert.objects.all().delete()

    pulled = Post.objects.create(
        author=host, status=Post.Status.HIDDEN, audience=Post.Audience.FOLLOWERS,
        text='console QA sample — four people reported this post and the counter already hid it',
    )
    stall = Post.objects.create(
        author=host, status=Post.Status.LIVE, audience=Post.Audience.FOLLOWERS,
        text='console QA sample — two people reported this one, which is under the pile',
    )
    chatter = Comment.objects.create(
        post=stall, author=host,
        text='console QA sample — three people reported this comment, and nothing hid it',
    )
    for_sale = Listing.objects.create(
        seller=host, title='console QA sample — a listing three people reported',
        price=Decimal('18500.00'),
    )

    four, three = strangers, strangers[:3]
    for index, who in enumerate(four):
        filed(pulled.pk, 'post', ('spam', 'scam', 'harassment', 'spam')[index], who, now - AGE)
    for who in three[:2]:
        filed(stall.pk, 'post', 'spam', who, now - AGE)
    for index, who in enumerate(three):
        filed(chatter.pk, 'comment', ('spam', 'harassment', 'spam')[index], who, now - AGE)
        filed(for_sale.pk, 'listing', ('scam', 'misleading', 'spam')[index], who, now - AGE)
    for who in three:
        filed(GONE_POST, 'post', 'spam', who, now - AGE)

    # The line the platform drew itself, so the audit screen has a row with no
    # person behind it — the one case that reads as a gap unless it is named.
    AuditLog.objects.create(
        actor=None, action='auto_hide_post', target=f'post:{pulled.pk}',
        detail=f'{MARK} — 4 open reports took this post out of the feed on their own',
    )

    for text, note, active in LINKS:
        PolicyTerm.objects.create(
            kind=PolicyTerm.Kind.LINK, text=text, note=note, is_active=active, created_by=actor,
        )

    # The four reporters that live outside these tables, in four different answers.
    AdminPulse.objects.create(
        key='web', label='The public site', state=AdminPulse.State.OK,
        detail='200 in 140 ms from the probe in Singapore',
        counts={'p95_ms': 140}, stamped_at=now - timedelta(minutes=3), stamps=41,
    )
    AdminPulse.objects.create(
        key='backup', label='Backups', state=AdminPulse.State.OK,
        detail='nightly dump, 2.1 GB', counts={'gb': 2.1},
        # Heard of, and gone quiet: the last run said nothing was wrong.
        stamped_at=now - timedelta(hours=31), stamps=28,
    )
    AdminPulse.objects.create(
        key='errors', label='App errors', state=AdminPulse.State.OK,
        detail='the collector is up and shipping counts',
        counts={'per_hour': 47}, stamped_at=now - timedelta(minutes=6), stamps=12,
    )
    # `jobs` is left out entirely — the transcoder has never reported to this
    # console, and the desk has to say that rather than invent a number for it.

    raised = alerts.scan()

    print(f'the pile: post {pulled.pk} hidden under 4 reporters, post {stall.pk} live under 2, '
          f'comment {chatter.pk} and listing {for_sale.pk} live under 3 each, '
          f'and {len(three)} reporters on post {GONE_POST}, which does not exist.')
    print(f'blocked links: {sum(1 for _t, _n, a in LINKS if a)} active, '
          f'{sum(1 for _t, _n, a in LINKS if not a)} retired.')
    print('pulses: the site is answering, the backup has not spoken in 31 hours, the error '
          'collector counts 47 an hour, and nothing at all reports the media queue.')
    print(f'the first scan raised {len(raised)} condition(s). '
          f'{alerts.counts()["attention"]} of them are a seat\'s to act on, '
          f'{alerts.counts()["unwired"]} are a wire nobody has run yet.')
    print('re-run any time: these accounts, reports, terms and pulses are rebuilt from nothing.')


if __name__ == '__main__':
    main()
