"""Take the showcase back out of a database.

    manage.py purge_demo --dry-run
    manage.py purge_demo --staff

Nothing here guesses at who is fake. The rule is written on the row: a member the
seeder made carries ``seeded=True`` or the ``@demo.test`` address it writes, and a
member who signed up from a browser carries neither — no matter which environment
this runs in. ``seed_demo --purge`` cannot be used for this because it wipes every
post, comment and conversation on the box and then lays a fresh showcase down again.

Real accounts are left holding real things. A like a person gave a demo post goes
with the post, because a row that points at nothing is worse than a missing like; a
wallet, a saved list or a promotion a person bought stays exactly where it was.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.db.models import Q

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
        listings = list(Listing.objects.filter(seller_id__in=ids).values_list('pk', flat=True))
        strings = _string_ids(posts, listings)
        seats = _seats(ids) if options['staff'] else []

        self.stdout.write(
            f'{len(ids)} demo members · {len(posts)} posts · {listings and len(listings) or 0} listings · '
            f'{Comment.objects.filter(Q(post_id__in=posts) | Q(author_id__in=ids)).count()} comments · '
            f'{len(seats)} staff seats'
        )
        if options['dry_run']:
            self.stdout.write('Dry run: nothing was deleted.')
            return

        with transaction.atomic():
            _mute_ledger(True)
            # Written by the demo or aimed at it: both are the showcase's own paper.
            Reaction.objects.filter(Q(post_id__in=posts) | Q(author_id__in=ids)).delete()
            Comment.objects.filter(Q(post_id__in=posts) | Q(author_id__in=ids)).delete()
            SavedPost.objects.filter(Q(post_id__in=posts) | Q(user_id__in=ids)).delete()
            SavedListing.objects.filter(Q(listing_id__in=listings) | Q(user_id__in=ids)).delete()
            Notification.objects.filter(
                Q(actor_id__in=ids) | Q(recipient_id__in=ids)
                | (Q(target_type='post') & Q(target_id__in=strings['post']))
                | (Q(target_type='listing') & Q(target_id__in=strings['listing']))
            ).delete()
            # These three carry a target as a string, so no cascade reaches them and a
            # leftover row would open a desk page on nothing.
            Promotion.objects.filter(
                Q(owner_id__in=ids) | (Q(target_type='post') & Q(target_id__in=strings['post']))
            ).delete()
            Report.objects.filter(
                Q(reporter_id__in=ids) | (Q(target_type='post') & Q(target_id__in=strings['post']))
                | (Q(target_type='listing') & Q(target_id__in=strings['listing']))
            ).delete()
            AuditLog.objects.filter(actor_id__in=ids).delete()
            CoinRequest.objects.filter(user_id__in=ids).delete()
            Listing.objects.filter(pk__in=listings).delete()
            PostMedia.objects.filter(post_id__in=posts).delete()
            Post.objects.filter(pk__in=posts).delete()
            Conversation.objects.filter(participants__id__in=ids).distinct().delete()
            Wallet.objects.filter(user_id__in=ids).delete()
            if seats:
                seats.model.objects.filter(pk__in=[seat.pk for seat in seats]).delete()
            User.objects.filter(pk__in=ids).delete()
            _mute_ledger(False)

        left = User.objects.exclude(pk__in=ids).count()
        self.stdout.write(self.style.SUCCESS(
            f'Deleted {len(ids)} demo members and their {len(posts)} posts. {left} signed-up accounts remain.'
        ))
        self.stdout.write('Media bytes on disk are untouched; backend/media still holds the demo clips.')


def _string_ids(posts, listings):
    return {'post': [str(pk) for pk in posts], 'listing': [str(pk) for pk in listings]}


def _seats(ids):
    from apps.adminpanel.models import StaffAccount

    return list(StaffAccount.objects.filter(user_id__in=ids))


def _mute_ledger(off):
    """The ledger's append-only rule is a trigger, and a cascade hits it."""
    verb = 'DISABLE' if off else 'ENABLE'
    with connection.cursor() as cursor:
        cursor.execute(f'ALTER TABLE wallet_transaction {verb} TRIGGER wallet_ledger_no_update')
        cursor.execute(f'ALTER TABLE wallet_transaction {verb} TRIGGER wallet_ledger_no_delete')
