import os
import shutil
import tempfile
from decimal import Decimal
from unittest import mock

from django.conf import settings

from django.db import connection
from django.http import Http404
from django.test import Client, RequestFactory, TestCase, override_settings
from django.test.utils import CaptureQueriesContext

from apps.common.mail import send_off_request
from apps.common.media import serve_media
from apps.common.testutils import auth_client, make_user
from apps.follows.models import Follow
from apps.marketplace.models import Listing
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.saved.models import SavedListing, SavedPost
from apps.wallet.models import apply

SYNC_KEYS = ('me', 'people', 'suggestions', 'follows', 'saves', 'promotions',
             'wallet', 'unread', 'config', 'server_time')


class SyncPayloadTests(TestCase):
    """One round-trip hydrates the whole client cache, so every key the client
    reads must actually be there — a missing field is a 500 in the browser."""

    def setUp(self):
        cache_user = make_user('syncone')
        self.user = cache_user
        self.other = make_user('synctwo')
        self.stranger = make_user('syncstranger')
        self.co = auth_client(cache_user)
        self.post = Post.objects.create(author=self.other, text='hello', audience='public')
        SavedPost.objects.create(user=cache_user, post=self.post)
        listing = Listing.objects.create(seller=self.other, title='bike', price=Decimal('400'), category='Bikes')
        self.listing = listing
        SavedListing.objects.create(user=cache_user, listing=listing)
        Follow.objects.create(follower=cache_user, followee=self.other, status=Follow.Status.ACCEPTED)
        Follow.objects.create(follower=self.other, followee=cache_user, status=Follow.Status.PENDING)
        Promotion.objects.create(owner=cache_user, target_type='post', target_id=str(self.post.pk),
                                 category='Bikes', package='speed', budget=Decimal('100'), status='active')
        apply(cache_user.wallet.pk, 'credit', 250, 'seed')

    def test_payload_shape(self):
        resp = self.co.get('/api/sync/')
        self.assertEqual(resp.status_code, 200)
        for key in SYNC_KEYS:
            self.assertIn(key, resp.data)
        self.assertEqual(resp.data['me']['username'], 'syncone')
        self.assertEqual(resp.data['wallet']['balance'], 250)
        self.assertEqual(resp.data['saves'], {'posts': [self.post.pk], 'listings': [self.listing.pk]})
        self.assertEqual(resp.data['unread'], {'notifications': 0, 'messages': 0})
        self.assertIn('packages', resp.data['config'])

    def test_graph_edges_and_cards(self):
        data = self.co.get('/api/sync/').data
        edges = {edge['id']: edge for edge in data['follows']}
        self.assertEqual(len(edges), 2)
        for edge in edges.values():
            self.assertEqual(set(edge), {'id', 'follower', 'following', 'status', 'ts'})
        cards = {card['id']: card for card in data['people']}
        self.assertIn(self.other.pk, cards)
        for field in ('id', 'username', 'name', 'avatar_url', 'cover_url', 'bio', 'verified',
                      'is_private', 'followers', 'following', 'role'):
            self.assertIn(field, cards[self.other.pk])
        suggestions = {card['id'] for card in data['suggestions']}
        self.assertIn(self.stranger.pk, suggestions)
        self.assertNotIn(self.other.pk, suggestions)
        self.assertNotIn(self.user.pk, suggestions)
        self.assertIn(self.stranger.pk, cards)

    def test_promotions_and_me_are_readable(self):
        data = self.co.get('/api/sync/').data
        promo = data['promotions'][0]
        self.assertEqual(promo['package'], 'speed')
        self.assertEqual(promo['target_id'], str(self.post.pk))
        for field in ('id', 'owner', 'target_type', 'category', 'age_min', 'age_max',
                      'country', 'city', 'budget', 'status', 'impressions', 'clicks',
                      'created_at', 'ends_at'):
            self.assertIn(field, promo)
        for field in ('id', 'username', 'email', 'name', 'avatar', 'cover', 'bio', 'role',
                      'verified', 'emailVerified', 'provider', 'dob', 'country', 'city',
                      'private', 'twoStep', 'joined', 'coins', 'susp', 'lockedUntil'):
            self.assertIn(field, data['me'])

    def test_anonymous_is_rejected(self):
        self.assertEqual(self.client.get('/api/sync/').status_code, 401)


class MetaConfigTests(TestCase):
    """The SPA shows a sign-in button only when this server can finish the flow."""

    def test_meta_reports_real_capabilities(self):
        resp = self.client.get('/api/meta/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['features']['googleLogin'])
        self.assertFalse(resp.data['features']['googleDemo'])
        self.assertEqual(resp.data['googleClientId'], '')
        self.assertIsNone(resp.data['demoGoogle'])

    @override_settings(DEBUG=True)
    def test_debug_server_offers_the_demo_google_identity(self):
        resp = self.client.get('/api/meta/')
        self.assertTrue(resp.data['features']['googleDemo'])
        self.assertEqual(resp.data['demoGoogle']['email'], 'guest@demo.test')

    @override_settings(GOOGLE_CLIENT_ID='apps-client-id')
    def test_configured_google_app_replaces_the_demo_offer(self):
        resp = self.client.get('/api/meta/')
        self.assertTrue(resp.data['features']['googleLogin'])
        self.assertFalse(resp.data['features']['googleDemo'])
        self.assertEqual(resp.data['googleClientId'], 'apps-client-id')


class MediaServingTests(TestCase):
    """Reels are seeked by tapping, which only works if /media answers Range
    requests. Tests run with DEBUG off, so these also prove a deployed build
    serves its own media rather than 404ing on every clip."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        os.makedirs(os.path.join(self.root, 'demo'))
        self.body = os.urandom(1000)
        with open(os.path.join(self.root, 'demo', 'clip.mp4'), 'wb') as handle:
            handle.write(self.body)

    def get(self, path, **extra):
        with override_settings(MEDIA_ROOT=self.root):
            response = self.client.get(path, **extra)
        # Reading a streaming response to the end is also what closes its file,
        # which matters on Windows where the temp folder cannot go away while a
        # handle is still open.
        if getattr(response, 'streaming', False):
            response.payload = b''.join(response.streaming_content)
        else:
            response.payload = response.content
        return response

    def test_serves_the_whole_file(self):
        response = self.get('/media/demo/clip.mp4')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Accept-Ranges'], 'bytes')
        self.assertEqual(response.payload, self.body)

    def test_serves_a_byte_range(self):
        response = self.get('/media/demo/clip.mp4', HTTP_RANGE='bytes=400-499')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Range'], 'bytes 400-499/1000')
        self.assertEqual(response.payload, self.body[400:500])

    def test_serves_a_trailing_range(self):
        response = self.get('/media/demo/clip.mp4', HTTP_RANGE='bytes=-20')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.payload, self.body[-20:])

    def test_rejects_a_range_past_the_end(self):
        response = self.get('/media/demo/clip.mp4', HTTP_RANGE='bytes=9000-')
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response['Content-Range'], 'bytes */1000')

    def test_ignores_media_that_is_not_there(self):
        self.assertEqual(self.get('/media/demo/nope.mp4').status_code, 404)

    def test_refuses_to_serve_a_type_a_browser_would_run(self):
        with open(os.path.join(self.root, 'demo', 'page.html'), 'w') as handle:
            handle.write('<script>alert(1)</script>')
        self.assertEqual(self.get('/media/demo/page.html').status_code, 404)

    def test_refuses_to_walk_outside_the_media_root(self):
        with override_settings(MEDIA_ROOT=self.root):
            with self.assertRaises(Http404):
                serve_media(RequestFactory().get('/media/x'), '../../exposing/settings.py')


class RequestIdTests(TestCase):
    """A report of "the server could not finish that request" has to name the
    line in the log it came from, or the next hour is spent guessing."""

    def test_every_answer_carries_one(self):
        self.assertTrue(self.client.get('/api/meta/')['X-Request-Id'])

    def test_an_id_that_arrived_is_the_id_that_goes_back(self):
        resp = self.client.get('/api/meta/', HTTP_X_REQUEST_ID='render-trace-7f3a')
        self.assertEqual(resp['X-Request-Id'], 'render-trace-7f3a')

    def test_junk_in_that_header_is_ignored_not_reflected(self):
        sent = ('<script>alert(1)</script>' + '\n') * 10
        got = self.client.get('/api/meta/', HTTP_X_REQUEST_ID=sent)['X-Request-Id']
        self.assertNotIn('<', got)
        self.assertTrue(len(got) <= 64)

    def test_an_api_error_names_its_request_in_the_body(self):
        resp = self.client.get('/api/sync/')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.data['request_id'], resp['X-Request-Id'])

    def test_a_crash_answers_with_json_an_id_and_no_html(self):
        # DEBUG off (as in a deploy) is when handler500 is the one answering.
        client = Client(raise_request_exception=False)
        with mock.patch('apps.common.health.probe', side_effect=RuntimeError('boom')):
            resp = client.get('/api/health/')
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(resp['Content-Type'], 'application/json')
        self.assertTrue(resp.json()['request_id'])
        self.assertIn('server', resp.json()['detail'].lower())


class HealthTests(TestCase):
    """What the client polls to tell a sleeping server from a broken one, and
    what an operator reads to learn which database the accounts are really in."""

    def test_answers_signed_out(self):
        resp = self.client.get('/api/health/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'ok')

    def test_names_the_database_instead_of_leaving_it_to_be_guessed(self):
        conf = settings.DATABASES['default']
        self.assertEqual(self.client.get('/api/health/').data['database'],
                         {'ok': True, 'engine': conf['ENGINE'].rsplit('.', 1)[-1], 'name': conf['NAME']})

    def test_says_whether_mail_goes_anywhere_and_who_eats_the_task(self):
        data = self.client.get('/api/health/').data
        # Tests swap in the locmem backend, so what is asserted is that a reader
        # can tell a provider from a sink — not which one this process happens to
        # be holding.
        self.assertTrue(data['email']['backend'].endswith('EmailBackend'))
        self.assertFalse(data['email']['delivered'])
        self.assertTrue(data['worker']['eager'])
        self.assertIn('backend', data['cache'])

    def test_never_throttled(self):
        # A client retries this while it waits; a rate limit here would turn a
        # cold start into a wall.
        codes = {self.client.get('/api/health/').status_code for _ in range(130)}
        self.assertEqual(codes, {200})

    def test_a_dead_database_is_reported_not_raised(self):
        with mock.patch('apps.common.health.connection') as conn:
            conn.cursor.side_effect = RuntimeError('down')
            resp = self.client.get('/api/health/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'degraded')
        self.assertFalse(resp.data['database']['ok'])


class PingTests(TestCase):
    """The keep-alive target: a cron fires at it every few minutes so the free
    instance never sleeps, and the browser polls it while waiting out a cold start.
    Both run unattended, so what matters is that it always answers and never costs
    anything — a probe that leans on the database would put the cron's own load on
    the service it is trying to keep awake."""

    def test_answers_signed_out(self):
        resp = self.client.get('/api/ping/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {'status': 'ok'})

    def test_a_head_monitor_gets_a_200_and_no_body(self):
        # Monitors that only want to know the port is open send HEAD, and DRF does
        # not allow it unless the view says so — a 405 there reads as downtime.
        resp = self.client.head('/api/ping/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.content), 0)

    def test_asks_the_database_for_nothing(self):
        with CaptureQueriesContext(connection) as queries:
            self.client.get('/api/ping/')
        self.assertEqual(len(queries), 0)

    def test_a_dead_database_does_not_stop_the_answer(self):
        # /api/health/ goes degraded here; the cron must keep firing or the whole
        # service falls asleep on top of the outage and stays down.
        with mock.patch('apps.common.health._database', return_value={'ok': False, 'error': 'OperationalError'}):
            self.assertEqual(self.client.get('/api/health/').data['status'], 'degraded')
        self.assertEqual(self.client.get('/api/ping/').status_code, 200)

    def test_never_throttled(self):
        codes = {self.client.get('/api/ping/').status_code for _ in range(130)}
        self.assertEqual(codes, {200})


class MailDeliveryTests(TestCase):
    """The rule these two tests exist to keep: a request never waits on a mail
    provider. A slow SMTP used to look exactly like a sign-up that never ended."""

    @override_settings(CELERY_TASK_ALWAYS_EAGER=False)
    def test_a_worker_gets_the_queue(self):
        task = mock.Mock()
        send_off_request(task, 'a@b.test', '123456', 'verify')
        task.delay.assert_called_once_with('a@b.test', '123456', 'verify')

    @override_settings(CELERY_TASK_ALWAYS_EAGER=True)
    def test_without_a_worker_the_send_leaves_the_request(self):
        task = mock.Mock()
        with mock.patch('apps.common.mail.threading.Thread') as thread:
            send_off_request(task, 'a@b.test', '123456', 'verify')
        thread.return_value.start.assert_called_once_with()
        task.delay.assert_not_called()
