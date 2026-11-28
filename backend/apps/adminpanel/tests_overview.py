"""Contract 6.2: what the dashboard counts, what it warns about, and what it admits it cannot measure.

The arithmetic is tested against `stats` directly, a window boundary is a
statement about data, not about HTTP, and the endpoints are tested for shape,
for the permission that opens them and for the alert wiring a client actually
clicks.
"""

from datetime import timedelta
from decimal import Decimal
import os
import shutil
import tempfile

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.auth import issue_access
from apps.comments.models import Comment
from apps.common.testutils import make_user
from apps.follows.models import Follow
from apps.marketplace.models import Listing
from apps.moderation.models import AuditLog, Report
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.reactions.models import Reaction
from apps.saved.models import SavedListing, SavedPost
from apps.wallet.models import CoinRequest, Transaction, Wallet

from . import alerts, settings_store, stats
from .models import AdminAlert, AdminSetting, StaffAccount
from .tests_staff import RbacTestCase

OVERVIEW_URL = '/api/admin/overview/'
PROMO_URL = '/api/admin/analytics/promotions/'


def stamp(row, **fields):
    """These tables stamp their own creation time, so history has to be written after the fact."""
    type(row).objects.filter(pk=row.pk).update(**fields)
    return row


def member(username, joined=None):
    row = make_user(username, password='Test-Pass-9271')
    return stamp(row, date_joined=joined) if joined else row


def post(author, created=None, **extra):
    row = Post.objects.create(author=author, text='A thing happened.', **extra)
    return stamp(row, created_at=created) if created else row


class WindowTests(TestCase):
    """The three windows the contract names, and the series under them."""

    def setUp(self):
        self.cutoffs = stats.windows()
        today = self.cutoffs['today']
        now = self.cutoffs['now']
        # Halfway between midnight and now: "today" is only two minutes long if
        # this suite starts just after midnight, and a fixed offset would fall
        # into yesterday.
        self.today = today + (now - today) / 2
        self.yesterday = today - timedelta(hours=6)
        self.fortnight = now - timedelta(days=14)
        self.ancient = now - timedelta(days=60)

    def test_a_rate_tile_counts_every_window_it_advertises(self):
        for index, when in enumerate((self.today, self.yesterday, self.fortnight, self.ancient)):
            author = member(f'author{index}')
            post(author, created=when)

        tile = next(tile for tile in stats.tiles(self.cutoffs) if tile['id'] == 'posts')
        self.assertEqual(tile['today'], 1, 'only the one made since midnight')
        self.assertEqual(tile['week'], 2, 'the fortnight-old one has aged out')
        self.assertEqual(tile['month'], 3)
        self.assertEqual(tile['total'], 4, 'the total is the whole table, not the last month')

    def test_accounts_listings_and_comments_use_their_own_clock(self):
        joined = self.cutoffs['today'] + (self.cutoffs['now'] - self.cutoffs['today']) / 2
        author = member('joiner', joined=joined)
        Comment.objects.create(post=post(author), author=author, text='nice')
        Listing.objects.create(seller=author, title='Bike', price=Decimal('1500'))

        tiles = {tile['id']: tile for tile in stats.tiles(self.cutoffs)}
        self.assertEqual(tiles['new_users']['today'], 1, 'date_joined, not a created_at column')
        self.assertEqual(tiles['comments']['total'], 1)
        self.assertEqual(tiles['listings']['total'], 1)

    def test_the_series_is_one_point_per_day_with_no_holes(self):
        tile = next(tile for tile in stats.tiles(self.cutoffs) if tile['id'] == 'new_users')
        series = tile['series']
        self.assertEqual(len(series), stats.SERIES_DAYS)
        self.assertEqual(series[-1]['day'], self.cutoffs['now'].date().isoformat())
        self.assertEqual(series[0]['day'], (self.cutoffs['today'] - timedelta(days=stats.SERIES_DAYS - 1)).date().isoformat())
        self.assertTrue(all('n' in point for point in series), 'a gap reads as zero, never as missing')

    def test_a_post_the_site_cannot_show_is_off_the_card(self):
        author = member('deleter')
        post(author, status=Post.Status.REMOVED)
        tile = next(tile for tile in stats.tiles(self.cutoffs) if tile['id'] == 'posts')
        self.assertEqual(tile['total'], 0, 'the card counts what a reader can be handed, not history')

    def test_a_comment_under_a_post_that_is_gone_is_off_the_card(self):
        author = member('quiet')
        gone = post(author, status=Post.Status.REMOVED)
        Comment.objects.create(post=gone, author=author, text='nice')
        tile = next(tile for tile in stats.tiles(self.cutoffs) if tile['id'] == 'comments')
        self.assertEqual(tile['total'], 0)

    def test_a_sold_offer_is_said_apart_and_a_deleted_one_is_not_said_at_all(self):
        author = member('seller')
        Listing.objects.create(seller=author, title='Bike', price=Decimal('1500'),
                               status=Listing.Status.SOLD)
        Listing.objects.create(seller=author, title='Helmet', price=Decimal('900'))
        Listing.objects.create(seller=author, title='Pump', price=Decimal('300'),
                               status=Listing.Status.REMOVED)
        tile = next(tile for tile in stats.tiles(self.cutoffs) if tile['id'] == 'listings')
        self.assertEqual(tile['total'], 2, 'the ad the seller deleted is out of both numbers')
        self.assertEqual(dict(tile['parts']),
                         {'On the market': 1, 'Marked sold': 1, 'Taken down by staff': 0})


class QueueTileTests(TestCase):
    """Reports, coin requests and campaigns: depth, age and what closed."""

    def setUp(self):
        self.cutoffs = stats.windows()
        self.now = self.cutoffs['now']
        self.member = member('queue_member')
        self.reporter = member('queue_reporter')
        self.other = member('queue_third')

    def test_open_reports_are_counted_by_state_not_by_history(self):
        target = post(self.member)
        for index, who in enumerate((self.reporter, self.other, self.member)):
            stamp(
                Report.objects.create(reporter=who, target_type='post', target_id=str(target.pk), reason='spam'),
                created_at=self.now - timedelta(minutes=5 + index),
            )
        closed = stamp(
            Report.objects.create(reporter=self.reporter, target_type='comment', target_id='99', reason='harassment'),
            created_at=self.now - timedelta(days=2),
        )
        closed.status = Report.Status.DISMISSED
        closed.resolved_at = self.now - timedelta(hours=3)
        closed.save(update_fields=['status', 'resolved_at'])

        tile = next(tile for tile in stats.tiles(self.cutoffs) if tile['id'] == 'open_reports')
        self.assertEqual(tile['value'], 3)
        self.assertEqual(tile['by_target'], {'post': 3})
        self.assertEqual(tile['by_reason'][0], {'reason': 'spam', 'n': 3})
        self.assertEqual(tile['closed_week'], 1, 'work done this week is on the same card')
        self.assertGreaterEqual(tile['oldest_minutes'], 4)

    def test_an_empty_queue_is_zero_rather_than_null(self):
        tile = next(tile for tile in stats.tiles(self.cutoffs) if tile['id'] == 'open_reports')
        self.assertEqual(tile['value'], 0)
        self.assertEqual(tile['by_target'], {})
        self.assertEqual(tile['oldest_minutes'], 0, 'nothing waiting has an age of zero, not a missing age')

    def test_the_coin_tile_keeps_the_waiting_queue_apart_from_what_sold(self):
        wallet, _created = Wallet.objects.get_or_create(user=self.member)
        waiting = stamp(
            CoinRequest.objects.create(user=self.member, coins=300, amount=Decimal('3000')),
            created_at=self.now - timedelta(hours=5),
        )
        bought = CoinRequest.objects.create(user=self.member, coins=100, amount=Decimal('1000'),
                                            status=CoinRequest.Status.APPROVED)
        stamp(bought, reviewed_at=self.now - timedelta(days=2))
        # The ledger refuses an UPDATE from a database trigger, which is the point
        # of it, so the spend is written at the time it really happened: now.
        Transaction.objects.create(wallet=wallet, kind=Transaction.Kind.DEBIT, amount=Decimal('30'),
                                   note='Promotion budget')

        tile = next(item for item in stats.tiles(self.cutoffs) if item['id'] == 'coin_requests')
        self.assertEqual(tile['pending'], 1)
        self.assertEqual(tile['pending_coins'], 300)
        self.assertEqual(tile['pending_npr'], 3000.0)
        self.assertEqual(tile['sold_week'], 100, 'approved purchases, not the ledger credit behind them')
        self.assertEqual(tile['sold_month'], 100)
        self.assertEqual(tile['collected_npr'], 1000.0)
        self.assertGreaterEqual(tile['oldest_minutes'], 299)
        self.assertEqual(waiting.status, CoinRequest.Status.PENDING)

        ledger = next(item for item in stats.tiles(self.cutoffs) if item['id'] == 'coins_moved')
        self.assertEqual(ledger['spent_today'], 30)
        self.assertEqual(ledger['spent_week'], 30)
        self.assertEqual(ledger['credited_month'], 0, 'approving a request does not credit the ledger by itself')

    def test_a_reviewed_promotion_is_awaiting_and_a_live_one_is_active(self):
        # `draft` is the only un-reviewed state the site can write today, so the
        # tile says awaiting review rather than inventing a status.
        stamp(Promotion.objects.create(owner=self.member, target_type='post', target_id='1',
                                       status=Promotion.Status.DRAFT),
              created_at=self.now - timedelta(days=1))
        running = Promotion.objects.create(owner=self.member, target_type='post', target_id='2',
                                           status=Promotion.Status.ACTIVE, impressions=40, clicks=6,
                                           budget=Decimal('300'))
        stamp(running, created_at=self.now - timedelta(hours=2))
        expired = Promotion.objects.create(owner=self.member, target_type='post', target_id='3',
                                           status=Promotion.Status.ACTIVE, ends_at=self.now - timedelta(minutes=1))
        stamp(expired, created_at=self.now - timedelta(days=3))

        tile = next(item for item in stats.tiles(self.cutoffs) if item['id'] == 'promotions')
        self.assertEqual(tile['active'], 1, 'its window closed, so it is no longer running the feed')
        self.assertEqual(tile['awaiting_review'], 1)
        self.assertEqual(tile['started_month'], 3)
        self.assertEqual(tile['impressions_month'], 40)
        self.assertEqual(tile['clicks_month'], 6)


class StorageTests(TestCase):
    def setUp(self):
        cache.clear()
        self.root = tempfile.mkdtemp(prefix='admin-storage-')

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_uploaded_bytes_are_counted_by_kind(self):
        with override_settings(MEDIA_ROOT=self.root):
            os.makedirs(os.path.join(self.root, 'posts'), exist_ok=True)
            with open(os.path.join(self.root, 'posts', 'one.jpg'), 'wb') as handle:
                handle.write(b'x' * 700)
            with open(os.path.join(self.root, 'posts', 'two.mp4'), 'wb') as handle:
                handle.write(b'y' * 300)
            media = stats.storage_used(refresh=True)
        self.assertEqual(media['state'], 'ok')
        self.assertEqual(media['bytes'], 1000)
        self.assertEqual(media['files'], 2)
        self.assertEqual(media['by_kind'], {'jpg': 1, 'mp4': 1})

    def test_a_server_with_no_disk_says_so_instead_of_claiming_zero_used(self):
        with override_settings(MEDIA_ROOT=os.path.join(self.root, 'absent')):
            media = stats.storage_used(refresh=True)
        self.assertEqual(media['state'], 'unknown')
        self.assertEqual(media['bytes'], 0)
        self.assertIn('No media directory', media['detail'])

    def test_the_walk_is_cached_until_somebody_asks_for_it_again(self):
        with override_settings(MEDIA_ROOT=self.root):
            with open(os.path.join(self.root, 'first.png'), 'wb') as handle:
                handle.write(b'z' * 10)
            stats.storage_used(refresh=True)
            with open(os.path.join(self.root, 'second.png'), 'wb') as handle:
                handle.write(b'z' * 90)
            self.assertEqual(stats.storage_used()['bytes'], 10, 'five minutes of one number is cheaper than a walk per paint')
            self.assertEqual(stats.storage_used(refresh=True)['bytes'], 100, 'the Reload button is the exception')


class HealthTests(TestCase):
    def setUp(self):
        self.cutoffs = stats.windows()

    def test_every_check_answers_with_a_sentence_a_client_can_act_on(self):
        health = stats.health(self.cutoffs, media={'state': 'ok', 'detail': 'Scanned.', 'bytes': 1, 'files': 1, 'by_kind': {}})
        ids = {check['id'] for check in health['checks']}
        self.assertEqual(ids, {'database', 'cache', 'email', 'ratelimits', 'media', 'audit'})
        for check in health['checks']:
            self.assertIn(check['state'], stats.STATE_RANK)
            self.assertTrue(check['detail'].endswith('.'), check)

    def test_switching_the_limits_off_shows_on_the_health_strip(self):
        with override_settings(EXPOSING_RATE_LIMITS=False):
            health = stats.health(self.cutoffs, media={'state': 'ok', 'detail': '.', 'bytes': 0, 'files': 0, 'by_kind': {}})
        self.assertEqual(health['state'], 'off', 'a test box must not read as a healthy live one')
        self.assertIn('test box', next(c for c in health['checks'] if c['id'] == 'ratelimits')['detail'])

    def test_an_unreadable_media_directory_is_not_reported_as_healthy(self):
        health = stats.health(self.cutoffs, media={'state': 'unknown', 'detail': '', 'bytes': 0, 'files': 0, 'by_kind': {}})
        self.assertEqual(next(c for c in health['checks'] if c['id'] == 'media')['state'], 'unknown')
        self.assertNotEqual(health['state'], 'ok')
        self.assertIn('No media directory', next(c for c in health['checks'] if c['id'] == 'media')['detail'])


class ThresholdTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_a_value_is_read_as_its_own_type_and_the_default_wins_when_it_is_not(self):
        self.assertEqual(settings_store.get('alert_report_pile'), 3)
        settings_store.write(None, {'alert_report_pile': 7})
        self.assertEqual(settings_store.get('alert_report_pile'), 7)
        AdminSetting.objects.filter(key='alert_report_pile').update(value='plenty')
        self.assertEqual(settings_store.get('alert_report_pile'), 3, 'a bad number falls back instead of 500-ing a screen')
        AdminSetting.objects.filter(key='alert_report_pile').update(value='')
        self.assertFalse(settings_store.cached()['alert_report_pile']['set'])

    def test_a_name_nobody_owns_is_refused(self):
        """A settings screen cannot invent a knob, and `coin_price` is one now."""
        self.assertEqual(settings_store.get('coin_price'), Decimal('10'))
        with self.assertRaises(ValueError):
            settings_store.write(None, {'alert_the_internet_is_down': 1})

    def test_the_picture_shows_which_knobs_have_been_turned(self):
        settings_store.write(None, {'alert_storage_gb': '12'})
        item = settings_store.cached()['alert_storage_gb']
        self.assertEqual(item['value'], Decimal('12'))
        self.assertTrue(item['set'])
        self.assertEqual(item['default'], Decimal('5'))
        self.assertTrue(item['label'] and item['help'])


class AlertTests(TestCase):
    """The conditions the site's own tables produce.

    `scan()` here returns those only: the four outside reporters each raise an INFO
    row until somebody wires a backup job or an uptime probe up to this console, and
    `tests_watch` covers those. Reading them into these assertions would make every
    "nothing is wrong" check say something is.
    """

    MEDIA = {'state': 'unknown', 'bytes': 0, 'files': 0, 'by_kind': {}, 'detail': ''}

    def setUp(self):
        cache.clear()
        self.now = timezone.now()
        self.member = member('pile_author')
        self.post = post(self.member)

    def scan(self):
        return [row for row in alerts.scan(self.now, media=self.MEDIA) if row.kind not in alerts.PULSES]

    def trouble(self):
        return AdminAlert.objects.exclude(kind__in=list(alerts.PULSES))

    def _pile(self, count):
        for index in range(count):
            reporter = member(f'reporter{index}')
            stamp(
                Report.objects.create(reporter=reporter, target_type='post', target_id=str(self.post.pk), reason='nudity'),
                created_at=self.now - timedelta(minutes=index + 1),
            )

    def test_a_report_pile_raises_one_alert_that_counts_up_rather_than_repeats(self):
        self._pile(3)
        raised = self.scan()
        self.assertEqual([row.kind for row in raised], ['report_pile'])
        self.assertEqual(self.trouble().count(), 1)
        self.assertIn('3 open reports', self.trouble().get().title)

        self.scan()
        row = self.trouble().get()
        self.assertEqual(self.trouble().count(), 1, 'one trouble is one row, however long it lasts')
        self.assertEqual(row.occurrences, 2)

    def test_two_reporters_are_not_a_pile_until_the_threshold_says_so(self):
        self._pile(2)
        self.assertEqual(self.scan(), [])

    def test_the_pile_threshold_is_a_setting_not_a_hard_code(self):
        self._pile(2)
        settings_store.write(None, {'alert_report_pile': 2})
        self.assertEqual([row.kind for row in self.scan()], ['report_pile'])

    def test_an_alert_clears_itself_when_the_reports_are_closed(self):
        self._pile(3)
        self.scan()
        self.assertEqual(self.trouble().get().status, AdminAlert.Status.OPEN)

        Report.objects.update(status=Report.Status.DISMISSED)
        self.scan()
        row = self.trouble().get()
        self.assertEqual(row.status, AdminAlert.Status.RESOLVED)
        self.assertIsNotNone(row.resolved_at)

    def test_a_coin_queue_only_ages_past_the_wait_it_was_given(self):
        waiting = CoinRequest.objects.create(user=self.member, coins=100, amount=Decimal('1000'))
        stamp(waiting, created_at=self.now - timedelta(hours=5))
        self.assertEqual(self.scan(), [], 'five hours is inside the 24 hour wait')

        settings_store.write(None, {'alert_coin_queue_hours': 2})
        self.assertEqual([row.kind for row in self.scan()], ['coin_queue_ageing'])
        self.assertIn('100 coins', self.trouble().get().detail)

    def test_lockouts_alert_a_pattern_and_not_one_person_having_a_bad_morning(self):
        first = StaffAccount.objects.create(user=member('locked1'), totp_locked_until=self.now + timedelta(minutes=9))
        self.assertEqual(self.scan(), [])

        StaffAccount.objects.create(user=member('locked2'), totp_locked_until=self.now + timedelta(minutes=4))
        self.assertEqual([row.kind for row in self.scan()], ['staff_lockouts'])
        self.assertEqual(self.trouble().get().severity, AdminAlert.Severity.CRITICAL)

        StaffAccount.objects.filter(pk=first.pk).update(totp_locked_until=None)
        self.scan()
        self.assertEqual(self.trouble().get().status, AdminAlert.Status.RESOLVED, 'one seat left is not a pattern')

    def test_a_wave_of_auto_hides_is_called_out_with_the_threshold_that_caused_it(self):
        for _ in range(10):
            AuditLog.objects.create(action='auto_hide_post', target='post:1', detail='3 open reports')
        AuditLog.objects.filter(action='auto_hide_post').update(created_at=self.now - timedelta(hours=2))
        self.assertIn('autohide_wave', [row.kind for row in self.scan()])
        row = AdminAlert.objects.get(kind='autohide_wave')
        self.assertEqual(row.severity, AdminAlert.Severity.CRITICAL)
        self.assertIn('(3)', row.detail, 'the sentence names the threshold that pulled it off')

    def test_storage_alerts_at_the_limit_it_is_given(self):
        media = {'state': 'ok', 'bytes': 6 * 1024 ** 3, 'files': 12, 'by_kind': {'mp4': 12}, 'detail': '.'}
        self.assertEqual(
            [row.kind for row in alerts.scan(self.now, media=media) if row.kind not in alerts.PULSES],
            ['storage_high'])
        self.assertEqual(self.trouble().get().context['limit_gb'], 5.0)

        settings_store.write(None, {'alert_storage_gb': '20'})
        self.scan()
        self.assertEqual(self.trouble().get().status, AdminAlert.Status.RESOLVED)

    def test_an_alert_points_at_the_screen_that_clears_it(self):
        self._pile(3)
        self.scan()
        row = self.trouble().get()
        self.assertEqual(row.href, '/reports?target=post&status=open', 'the queue filter that shows this post')
        self.assertEqual(alerts.feed(5)[0]['key'], row.key, 'a fire is listed above a wire to run')

    def test_an_unwired_reporter_is_counted_apart_from_a_fire(self):
        """A fresh install has four monitoring jobs nobody has wired up, and no trouble."""
        self._pile(3)
        self.scan()
        counts = alerts.counts()
        self.assertEqual(counts['unwired'], 4)
        self.assertEqual(counts['attention'], 1)



class PromotionPerformanceTests(TestCase):
    def setUp(self):
        self.cutoffs = stats.windows()
        self.now = self.cutoffs['now']
        self.owner = member('booster')
        self.post = post(self.owner)
        self.promo = Promotion.objects.create(
            owner=self.owner, target_type='post', target_id=str(self.post.pk),
            package='pk_growth', status=Promotion.Status.ACTIVE, budget=Decimal('300'),
            impressions=200, clicks=20, ends_at=self.now + timedelta(days=5),
        )
        stamp(self.promo, created_at=self.now - timedelta(days=2))

    def _row(self):
        return stats.promotion_performance(self.cutoffs)[0]

    def test_views_and_opens_come_from_the_campaign_and_spend_from_its_budget(self):
        row = self._row()
        self.assertEqual(row['metrics']['views'], 200)
        self.assertEqual(row['metrics']['opens'], 20)
        self.assertEqual(row['metrics']['coins_spent'], 300)
        self.assertEqual(row['click_rate'], 10.0)

    def test_a_result_counts_only_if_it_landed_while_the_campaign_was_live(self):
        before = member('before_reader')
        during = member('during_reader')
        Reaction.objects.create(user=before, target_type='post', target_id=str(self.post.pk), kind='like')
        stamp(Reaction.objects.get(user=before), created_at=self.now - timedelta(days=4))
        Reaction.objects.create(user=during, target_type='post', target_id=str(self.post.pk), kind='love')
        stamp(Reaction.objects.get(user=during), created_at=self.now - timedelta(hours=6))

        Comment.objects.create(post=self.post, author=before, text='old')
        stamp(Comment.objects.get(text='old'), created_at=self.now - timedelta(days=9))
        Comment.objects.create(post=self.post, author=during, text='new')
        stamp(Comment.objects.get(text='new'), created_at=self.now - timedelta(hours=1))

        SavedPost.objects.create(user=before, post=self.post)
        stamp(SavedPost.objects.get(user=before), created_at=self.now - timedelta(days=30))
        SavedPost.objects.create(user=during, post=self.post)
        stamp(SavedPost.objects.get(user=during), created_at=self.now - timedelta(hours=2))

        follower = member('follower')
        Follow.objects.create(follower=follower, followee=self.owner, status=Follow.Status.ACCEPTED)
        stamp(Follow.objects.get(follower=follower), created_at=self.now - timedelta(hours=3))

        row = self._row()
        self.assertEqual(row['metrics']['reactions'], 1)
        self.assertEqual(row['metrics']['comments'], 1)
        self.assertEqual(row['metrics']['saves'], 1)
        self.assertEqual(row['metrics']['new_followers'], 1)
        self.assertGreater(row['minutes_live'], 2800)

    def test_a_reaction_to_the_video_on_that_post_belts_to_the_campaign(self):
        from apps.posts.models import PostMedia
        media = PostMedia.objects.create(post=self.post, kind='video')
        viewer = member('watcher')
        Reaction.objects.create(user=viewer, target_type='media', target_id=str(media.pk), kind='like')
        stamp(Reaction.objects.get(user=viewer), created_at=self.now - timedelta(hours=4))
        self.assertEqual(self._row()['metrics']['reactions'], 1)

    def test_a_listing_campaign_scores_saves_and_claims_no_social_results(self):
        listing = Listing.objects.create(seller=self.owner, title='Bike', price=Decimal('1500'))
        promo = Promotion.objects.create(owner=self.owner, target_type='listing', target_id=str(listing.pk),
                                         status=Promotion.Status.ACTIVE)
        stamp(promo, created_at=self.now - timedelta(days=1))
        buyer = member('buyer')
        SavedListing.objects.create(user=buyer, listing=listing)
        stamp(SavedListing.objects.get(user=buyer), created_at=self.now - timedelta(hours=5))

        row = stats.promotion_performance(self.cutoffs)[0]
        self.assertEqual(row['target'], f'listing:{listing.pk}')
        self.assertEqual(row['metrics']['saves'], 1)
        self.assertEqual(row['metrics']['comments'], 0, 'a listing has no comment thread')
        self.assertIsNone(row['click_rate'], 'nobody saw it, so a rate would be a division by nothing')

    def test_no_metric_is_left_as_an_unmeasured_gap(self):
        row = self._row()
        self.assertEqual(row['unmeasured'], {})
        self.assertIn('messages', row['metrics'], 'a chat the advert carried the reader into is counted')
        self.assertEqual(len(stats.METRIC_LABELS), len(row['metrics']) + len(row['unmeasured']))


@override_settings(MEDIA_ROOT=os.path.join(tempfile.gettempdir(), 'exposing-admin-no-media'))
class OverviewEndpointTests(RbacTestCase):
    """No disk to walk, so the storage tile is honestly `unknown` here and cannot
    raise its own alert into a test that is counting report piles."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def test_the_dashboard_arrives_whole(self):
        member('someone_new')
        payload = self.client_owner_dashboard()
        self.assertEqual(payload['tiles'][0]['id'], 'new_users')
        self.assertEqual(
            [tile['id'] for tile in payload['tiles']],
            ['new_users', 'posts', 'comments', 'listings', 'open_reports', 'coin_requests',
             'promotions', 'storage', 'coins_moved'],
        )
        self.assertEqual(len(payload['tiles'][0]['series']), stats.SERIES_DAYS)
        self.assertIn('checks', payload['health'])
        self.assertIn('recent', payload['alerts'])
        self.assertIn('alert_report_pile', payload['thresholds'])
        self.assertEqual(payload['windows']['series_days'], stats.SERIES_DAYS)

    def client_owner_dashboard(self, query=''):
        """One console tab per test: a second sign-in for the same seat comes back
        asking for a code, not offering a secret, so `session()` would fail."""
        client = self.session('client_owner')
        response = client.get(OVERVIEW_URL + query)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_a_moderator_sees_the_numbers_because_the_role_ships_with_the_screen(self):
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        mod = self.session('night_mod')
        self.assertEqual(mod.get(OVERVIEW_URL).status_code, 200)

    def test_a_seat_the_screen_was_taken_from_is_told_which_key_it_lacks(self):
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR, denied_keys=['overview'])
        mod = self.session('night_mod')
        response = mod.get(OVERVIEW_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'permission_required')
        self.assertEqual(response.data['permission'], 'overview')

    def test_an_ordinary_account_is_not_shown_the_platform_its_making(self):
        client = APIClient()
        self.assertIn(client.get(OVERVIEW_URL).status_code, (401, 403))
        signed_up = make_user('curious', password='Test-Pass-9271')
        client.cookies['exposing_access'] = issue_access(signed_up)
        turned_away = client.get(OVERVIEW_URL)
        self.assertEqual(turned_away.status_code, 403)
        self.assertEqual(turned_away.data['code'], 'staff_only')

    def test_the_alert_feed_is_the_dashboard_warning_list(self):
        author = member('pile_author')
        target = post(author)
        for index in range(3):
            stamp(
                Report.objects.create(reporter=member(f'reporter{index}'), target_type='post',
                                      target_id=str(target.pk), reason='spam'),
                created_at=timezone.now() - timedelta(minutes=index + 1),
            )
        data = self.client_owner_dashboard()
        self.assertEqual(data['alerts']['counts']['attention'], 1)
        self.assertEqual(data['alerts']['counts']['unwired'], 4,
                         'four reporters nobody has wired in yet, a checklist, not four fires')
        self.assertIn('3 open reports', data['alerts']['recent'][0]['title'])

    def test_the_campaign_table_is_a_second_call_so_the_fold_paints_first(self):
        owner = self.session('client_owner')
        booster = member('booster')
        Promotion.objects.create(owner=booster, target_type='post', target_id='1',
                                 status=Promotion.Status.ACTIVE, impressions=90, clicks=9)
        response = owner.get(PROMO_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['metrics']), 9)
        self.assertEqual(response.data['rows'][0]['owner'], 'booster')
        self.assertEqual(response.data['totals']['views'], 90)
        self.assertEqual(response.data['unmeasured'], {})

    def test_the_row_count_is_a_number_even_when_the_query_string_is_not(self):
        owner = self.session('client_owner')
        for index in range(3):
            Promotion.objects.create(owner=member(f'booster{index}'), target_type='post',
                                     target_id=str(index), status=Promotion.Status.ENDED)
        self.assertEqual(owner.get(PROMO_URL + '?limit=2').data['shown'], 2)
        self.assertEqual(owner.get(PROMO_URL + '?limit=plenty').data['shown'], 3)
        self.assertEqual(owner.get(PROMO_URL + '?limit=9999').data['shown'], 3, 'the ceiling is the point')
