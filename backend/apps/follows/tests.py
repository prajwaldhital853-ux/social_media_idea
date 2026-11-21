from django.core.cache import cache
from django.test import TestCase, TransactionTestCase

from apps.accounts.models import User
from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Follow
from apps.notifications.models import Notification


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
        resp = self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Follow.objects.filter(follower=self.a, followee=self.b).count(), 1)

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

    def test_unfollow_removes_edge(self):
        self.ca.post('/api/follows/', {'username': 'followb'}, format='json')
        resp = self.ca.delete('/api/follows/followb/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Follow.objects.filter(follower=self.a, followee=self.b).exists())
        resp = self.ca.delete('/api/follows/followb/')
        self.assertEqual(resp.status_code, 404)


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