from django.core.cache import cache
from django.db.models import Q
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Block, Follow
from apps.notifications.models import Notification
from apps.posts.models import Post


class FollowTests(TestCase):
    def setUp(self):
        cache.clear()
        self.a = make_user('followa')
        self.b = make_user('followb')
        self.ca = auth_client(self.a)
        self.cb = auth_client(self.b)

    def test_public_follow_accepted_and_notified(self):
        resp = self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'accepted')
        self.assertTrue(Notification.objects.filter(recipient=self.b, kind='follow').exists())

    def test_self_follow_and_duplicate_rejected(self):
        resp = self.ca.post('/api/follows/', {'username': 'followa'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        # A stale client repeating the POST (double-tap, another device, a sync
        # window that dropped the row) reads the true state instead of an error,
        # and the target is not notified a second time.
        resp = self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'accepted')
        self.assertEqual(resp.data['created'], False)
        self.assertEqual(Follow.objects.filter(follower=self.a, followee=self.b).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.b, kind='follow').count(), 1)

    def test_private_follow_pending_accept_decline(self):
        self.b.profile.is_private = True
        self.b.profile.save()
        resp = self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        self.assertEqual(resp.data['status'], 'pending')
        self.assertTrue(Notification.objects.filter(recipient=self.b, kind='follow_request').exists())
        reqs = self.cb.get('/api/follows/requests/')
        self.assertEqual(len(reqs.data['results']), 1)
        request_id = reqs.data['results'][0]['request_id']
        self.assertEqual(reqs.data['results'][0]['username'], 'followa')
        resp = self.cb.post(f'/api/follows/requests/{request_id}/accept/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Follow.objects.get(follower=self.a, followee=self.b).status, 'accepted')
        self.assertTrue(Notification.objects.filter(recipient=self.a, kind='follow_accept').exists())
        self.ca.delete('/api/follows/followb/')
        self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        reqs = self.cb.get('/api/follows/requests/')
        request_id = reqs.data['results'][0]['request_id']
        resp = self.cb.post(f'/api/follows/requests/{request_id}/decline/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Follow.objects.filter(follower=self.a, followee=self.b).exists())

    def test_re_requesting_a_private_account_asks_again(self):
        self.b.profile.is_private = True
        self.b.profile.save()
        self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        edge = Follow.objects.get(follower=self.a, followee=self.b)
        self.cb.post(f'/api/follows/requests/{edge.pk}/accept/')
        # The unfollow that should have cleared this row never reached the
        # database, so B still holds an accepted edge from A. Asking again has
        # to hand B a question to answer, not a receipt for the old answer.
        resp = self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        self.assertEqual(resp.data['status'], 'pending')
        edge.refresh_from_db()
        self.assertEqual(edge.status, 'pending')
        reqs = self.cb.get('/api/follows/requests/')
        self.assertEqual([r['username'] for r in reqs.data['results']], ['followa'])

    def test_only_followee_can_act_on_request(self):
        self.b.profile.is_private = True
        self.b.profile.save()
        self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        edge = Follow.objects.get(follower=self.a, followee=self.b)
        resp = self.ca.post(f'/api/follows/requests/{edge.pk}/accept/')
        self.assertEqual(resp.status_code, 404)

    def test_followers_following_pages_and_mutuals(self):
        for i in range(15):
            fan = make_user(f'fan{i}')
            Follow.objects.create(follower=fan, followee=self.a, status='accepted')
        Follow.objects.create(follower=self.a, followee=self.b, status='accepted')
        Follow.objects.create(follower=self.b, followee=self.a, status='accepted')
        page1 = self.ca.get('/api/users/followa/followers/')
        self.assertEqual(len(page1.data['results']), 10)
        self.assertTrue(page1.data['has_more'])
        page2 = self.ca.get('/api/users/followa/followers/?cursor=' + page1.data['next_cursor'])
        ids1 = {r['id'] for r in page1.data['results']}
        self.assertFalse(ids1.intersection({r['id'] for r in page2.data['results']}))
        self.assertEqual(len(page1.data['results']) + len(page2.data['results']), 16)
        following = self.ca.get('/api/users/followa/following/')
        self.assertEqual(following.data['results'][0]['username'], 'followb')
        mutuals = self.ca.get('/api/follows/mutuals/')
        self.assertEqual([u['username'] for u in mutuals.data['results']], ['followb'])
        state = self.ca.get('/api/follows/state/followb/')
        self.assertEqual(state.data['state'], 'accepted')
        self.assertTrue(state.data['follows_me'])

    def test_public_circles_are_readable_without_signing_in(self):
        Follow.objects.create(follower=self.b, followee=self.a, status='accepted')
        resp = APIClient().get('/api/users/followa/followers/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([u['username'] for u in resp.data['results']], ['followb'])

    def test_private_account_hides_its_circles_from_strangers(self):
        Follow.objects.create(follower=self.b, followee=self.a, status='accepted')
        self.a.profile.is_private = True
        self.a.profile.save(update_fields=['is_private'])
        stranger = make_user('followstranger')
        self.assertEqual(APIClient().get('/api/users/followa/followers/').data['results'], [])
        self.assertEqual(auth_client(stranger).get('/api/users/followa/followers/').data['results'], [])
        self.assertEqual(len(auth_client(self.a).get('/api/users/followa/followers/').data['results']), 1)
        Follow.objects.create(follower=stranger, followee=self.a, status='accepted')
        self.assertEqual(len(auth_client(stranger).get('/api/users/followa/followers/').data['results']), 2)

    def test_unfollow_removes_edge(self):
        self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        resp = self.ca.delete('/api/follows/followb/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Follow.objects.filter(follower=self.a, followee=self.b).exists())
        resp = self.ca.delete('/api/follows/followb/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['removed'])


class FollowConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.a = make_user('conca')
        self.b = make_user('concb')

    def test_simultaneous_duplicate_follows_create_one_row(self):
        clients = [auth_client(self.a) for _ in range(8)]

        def follow(client):
            return client.post('/api/follows/', {'username': 'concb'}, format='json').status_code

        codes = run_threads(follow, clients)
        self.assertEqual(codes.count(201), 1)
        self.assertEqual(Follow.objects.filter(follower=self.a, followee=self.b).count(), 1)

class BlockTests(TestCase):
    def setUp(self):
        cache.clear()
        self.a = make_user('blocka')
        self.b = make_user('blockb')
        self.ca = auth_client(self.a)
        self.cb = auth_client(self.b)
        self.a_post = Post.objects.create(author=self.a, text='what a posted', audience='public')
        self.b_post = Post.objects.create(author=self.b, text='what b posted', audience='public')

    def test_blocking_severs_the_follow_in_both_directions(self):
        Follow.objects.create(follower=self.a, followee=self.b, status='accepted')
        Follow.objects.create(follower=self.b, followee=self.a, status='accepted')
        resp = self.ca.post('/api/blocks/', {'username': 'blockb'}, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Follow.objects.filter(Q(follower=self.a, followee=self.b) |
                                               Q(follower=self.b, followee=self.a)).count(), 0)

    def test_a_block_hides_their_posts_from_both_of_you(self):
        self.ca.post('/api/blocks/', {'username': 'blockb'}, format='json')
        ids = [row['id'] for row in self.ca.get('/api/feed/').data['results']]
        self.assertNotIn(self.b_post.pk, ids)
        # The blocked person loses the blocker's public posts too, without being told why.
        ids = [row['id'] for row in self.cb.get('/api/feed/').data['results']]
        self.assertNotIn(self.a_post.pk, ids)

    def test_a_blocked_author_cannot_be_reached_or_followed(self):
        self.ca.post('/api/blocks/', {'username': 'blockb'}, format='json')
        self.assertEqual(self.cb.get(f'/api/posts/{self.a_post.pk}/').status_code, 404)
        self.assertEqual(self.cb.post('/api/follows/', {'username': 'blocka'}, format='json').status_code, 403)

    def test_blocking_yourself_is_refused_and_repeat_blocking_settles(self):
        self.assertEqual(self.ca.post('/api/blocks/', {'username': 'blocka'}, format='json').status_code, 400)
        self.ca.post('/api/blocks/', {'username': 'blockb'}, format='json')
        resp = self.ca.post('/api/blocks/', {'username': 'blockb'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['created'])
        self.assertEqual(Block.objects.filter(blocker=self.a).count(), 1)

    def test_the_block_list_and_state_answer_to_the_blocker(self):
        self.ca.post('/api/blocks/', {'username': 'blockb'}, format='json')
        self.assertEqual([row['username'] for row in self.ca.get('/api/follows/blocked/').data['results']], ['blockb'])
        self.assertTrue(self.ca.get('/api/follows/state/blockb/').data['blocked'])
        # The blocked person is not told they are blocked, so their own state stays clean.
        b_state = self.cb.get('/api/follows/state/blocka/').data
        self.assertFalse(b_state['blocked'])
        self.assertTrue(b_state['blocked_me'])

    def test_unblocking_is_idempotent_and_brings_the_posts_back(self):
        self.ca.post('/api/blocks/', {'username': 'blockb'}, format='json')
        self.assertEqual(self.ca.delete('/api/blocks/blockb/').status_code, 200)
        self.assertEqual(self.ca.delete('/api/blocks/blockb/').status_code, 200)
        ids = [row['id'] for row in self.ca.get('/api/feed/').data['results']]
        self.assertIn(self.b_post.pk, ids)
