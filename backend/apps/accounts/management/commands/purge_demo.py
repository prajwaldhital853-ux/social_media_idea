"""Take the showcase back out of a database.

    manage.py purge_demo --dry-run
    manage.py purge_demo --staff --keep sita

Nothing here guesses at who is fake. The rule is written on the row: a member the
seeder made carries ``seeded=True`` or the ``@demo.test`` address it writes, and a
member who signed up from a browser carries neither — no matter which environment
this runs in. ``seed_demo --purge`` cannot be used for this because it wipes every
post, comment and conversation on the box and then lays a fresh showcase down again.

Real accounts are left holding real things. A like a person gave a demo post goes
with the post, because a row that points at nothing is worse than a missing like; a
wallet, a saved list or a promotion a person bought stays exactly where it was.

Half of the desks keep their target as ``target_type`` plus a string id rather than
a foreign key, so no cascade reaches them and this file has to name each one. The
like lives on a post, a photo inside a post and a comment, and a report or a notice
can be aimed at an account, so those are all listed — one leftover row is a desk
page that opens on nothing.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.db.models import Q

from apps.adminpanel.models import PublicNotice, StaffAccount
from apps.comments.models import Comment
from apps.marketplace.models import Listing
from apps.messages.models import Conversation
from apps.moderation.models import AuditLog, Report
from apps.notifications.models import Notification
from apps.posts.models import Post, PostMedia
from apps.promotions.models import Promotion
from apps.reactions.models import Reaction
from apps.saved.models import SavedListing, SavedPost
from apps.wallet.models import CoinRequest, Wallet

User = get_user_model()

DEMO_DOMAINS = ('@demo.test', '@test.local')


def _or_target(kind, strings):
    """Rows that name their target as text, not as a key."""
    return Q(target_type=kind) & Q(target_id__in=str(strings))


class Command(BaseCommand):
    help = 'Delete every demo account, post, comment and (with --staff) seat the seeder made.'

    def add_arguments(self, parser):
        parser.add_argument('--staff', action='store_true',
                            help='Also delete the console seats held by demo profiles.')
        parser.add_argument('--keep', default='',
                            help='Comma separated demo usernames to spare, e.g. a seat you sign in with.')
        parser.add_argument('--dry-run', action='store_true', help='Count the rows and change nothing.')

    def handle(self, *args, **options):
        keep = {name.strip() for name in options['keep'].split(',') if name.strip()}
        demos = (User.objects
                 .filter(Q(seeded=True) | Q(email__endswith=DEMO_DOMAINS[0]) | Q(email__endswith=DEMO_DOMAINS[1]))
                 .exclude(username__in=keep))
        ids = list(demos.values_list('pk', flat=True))
        if not ids:
            self.stdout.write('No demo profiles on this box. Nothing was changed.')
            return

        posts = list(Post.objects.filter(author_id__in=ids).values_list('pk', flat=True))
        media = list(PostMedia.objects.filter(post_id__in=posts).values_list('pk', flat=True))
        listings = list(Listing.objects.filter(seller_id__in=ids).values_list('pk', flat=True))
        comments = list(Comment.objects.filter(Q(post_id__in=posts) | Q(author_id__in=ids))
                        .values_list('pk', flat=True))
        text = {'post': [str(pk) for pk in posts], 'media': [str(pk) for pk in media],
                'comment': [str(pk) for pk in comments], 'listing': [str(pk) for pk in listings],
                'user': [str(pk) for pk in ids]}

        seats = list(StaffAccount.objects.filter(user_id__in=ids)) if options['staff'] else []

        aimed = (_or_target('post', text['post']) | _or_target('media', text['media'])
                 | _or_target('comment', text['comment']) | _or_target('listing', text['listing'])
                 | _or_target('user', text['user']))
        # A member's own writing is the showcase; a stranger's reply under it is not
        # the showcase's row, but it would be left quoting a post that is gone.
        reactions = Reaction.objects.filter(Q(user_id__in=ids) | aimed)
        notes = Notification.objects.filter(Q(actor_id__in=ids) | Q(recipient_id__in=ids) | aimed)
        reports = Report.objects.filter(Q(reporter_id__in=ids) | aimed)
        notices = PublicNotice.objects.filter(Q(about_id__in=ids) | aimed)

        self.stdout.write(
            f'{len(ids)} demo members · {len(posts)} posts · {len(media)} photos or clips · '
            f'{len(listings)} listings · {len(comments)} comments · '
            f'{reactions.count()} reactions · {notes.count()} bell rows · '
            f'{reports.count()} reports · {notices.count()} notices · {len(seats)} staff seats'
        )
        if options['dry_run']:
            for seat in seats:
                self.stdout.write(f'  seat {seat.pk} · {seat.user.email} · {seat.effective_role} · '
                                  f'{"given by " + (seat.granted_by.email if seat.granted_by else "the seeder")}')
            self.stdout.write('Dry run: nothing was deleted.')
            return

        with transaction.atomic():
            _mute_ledger(True)
            reactions.delete()
            notes.delete()
            reports.delete()
            notices.delete()
            SavedPost.objects.filter(Q(post_id__in=posts) | Q(user_id__in=ids)).delete()
            SavedListing.objects.filter(Q(listing_id__in=listings) | Q(user_id__in=ids)).delete()
            Promotion.objects.filter(
                Q(owner_id__in=ids) | _or_target('post', text['post']) | _or_target('listing', text['listing'])
            ).delete()
            AuditLog.objects.filter(actor_id__in=ids).delete()
            CoinRequest.objects.filter(user_id__in=ids).delete()
            Comment.objects.filter(pk__in=comments).delete()
            Listing.objects.filter(pk__in=listings).delete()
            PostMedia.objects.filter(post_id__in=posts).delete()
            Post.objects.filter(pk__in=posts).delete()
            Conversation.objects.filter(participants__id__in=ids).distinct().delete()
            Wallet.objects.filter(user_id__in=ids).delete()
            if seats:
                StaffAccount.objects.filter(pk__in=[seat.pk for seat in seats]).delete()
            User.objects.filter(pk__in=ids).delete()
            _mute_ledger(False)

        left = User.objects.exclude(pk__in=ids).count()
        self.stdout.write(self.style.SUCCESS(
            f'Deleted {len(ids)} demo members and their {len(posts)} posts. {left} signed-up accounts remain.'
        ))
        self.stdout.write('Media bytes on disk are untouched; backend/media still holds the demo clips.')
        _report_leftovers(self, text)


def _report_leftovers(command, text):
    """Say out loud if any desk is still pointing at the showcase that was just taken away."""
    aimed = (_or_target('post', text['post']) | _or_target('media', text['media'])
             | _or_target('comment', text['comment']) | _or_target('listing', text['listing'])
             | _or_target('user', text['user']))
    dangling = {
        'reaction': Reaction.objects.filter(aimed).count(),
        'notification': Notification.objects.filter(aimed).count(),
        'report': Report.objects.filter(aimed).count(),
        'notice': PublicNotice.objects.filter(aimed).count(),
        'promotion': Promotion.objects.filter(aimed).count(),
    }
    stuck = {name: count for name, count in dangling.items() if count}
    if stuck:
        command.stdout.write(command.style.WARNING(
            f'Still pointing at the deleted showcase: {stuck}. Read it before you sign in again.'
        ))
    else:
        command.stdout.write('No desk row is left pointing at a deleted post, comment or account.')


def _mute_ledger(off):
    """The ledger's append-only rule is a trigger, and a cascade hits it."""
    verb = 'DISABLE' if off else 'ENABLE'
    with connection.cursor() as cursor:
        cursor.execute(f'ALTER TABLE wallet_transaction {verb} TRIGGER wallet_ledger_no_update')
        cursor.execute(f'ALTER TABLE wallet_transaction {verb} TRIGGER wallet_ledger_no_delete')
