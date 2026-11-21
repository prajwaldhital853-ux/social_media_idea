from decimal import Decimal

from django.test import TestCase, override_settings

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
