from django.core.cache import cache
from django.test import TestCase, TransactionTestCase

from apps.common.testutils import auth_client, make_user, run_threads
from apps.posts.models import Post
from apps.reactions.models import Reaction


class ReactionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('reactauthor')
        self.fan = make_user('reactfan')
        self.post = Post.objects.create(author=self.author, text='react me', audience='public')
        self.cf = auth_client(self.fan)

    def react(self, kind='like', client=None):
        return (client or self.cf).post(
            '/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.pk), 'kind': kind}, format='json',
        )

    def test_one_reaction_per_user_per_target(self):
        resp = self.react('like')
        self.assertEqual(resp.status_code, 201)
        resp = self.react('love')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Reaction.objects.filter(user=self.fan, target_type='post', target_id=str(self.post.pk)).count(), 1)
        self.post.refresh_from_db()
        self.assertEqual(self.post.like_count, 1)

    def test_toggle_off_decrements(self):
        self.react()
        resp = self.cf.delete('/api/reactions/toggle/', {'target_type': 'post', 'target_id': str(self.post.pk)}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.post.refresh_from_db()
        self.assertEqual(self.post.like_count, 0)
        resp = self.cf.delete('/api/reactions/toggle/', {'target_type': 'post', 'target_id': str(self.post.pk)}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_delete_by_id_decrements(self):
        resp = self.react()
        rid = resp.data['id']
        resp = self.cf.delete(f'/api/reactions/{rid}/')
        self.assertEqual(resp.status_code, 204)
        self.post.refresh_from_db()
        self.assertEqual(self.post.like_count, 0)

    def test_reaction_notifies_author_not_self(self):
        self.react()
        self.assertEqual(self.author.notifications.count(), 1)
        ca = auth_client(self.author)
        ca.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.pk), 'kind': 'like'}, format='json')
        self.assertEqual(self.author.notifications.count(), 1)


class ReactionConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('concreactauthor')
        self.post = Post.objects.create(author=self.author, text='viral', audience='public')

    def test_many_users_like_simultaneously_counter_exact(self):
        users = [make_user(f'concreact{i}') for i in range(15)]
        clients = [auth_client(u) for u in users]

        def like(client):
            return client.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.pk), 'kind': 'like'}, format='json').status_code

        codes = run_threads(like, clients, workers=10)
        self.assertEqual(codes, [201] * 15)
        self.post.refresh_from_db()
        self.assertEqual(self.post.like_count, 15)
        self.assertEqual(Reaction.objects.filter(target_id=str(self.post.pk)).count(), 15)

    def test_same_user_racing_likes_single_row_single_count(self):
        user = make_user('concdup')
        clients = [auth_client(user) for _ in range(8)]

        def like(client):
            return client.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.pk), 'kind': 'love'}, format='json').status_code

        codes = run_threads(like, clients)
        self.assertTrue(all(c in (200, 201) for c in codes), codes)
        self.assertEqual(codes.count(201), 1)
        self.post.refresh_from_db()
        self.assertEqual(self.post.like_count, 1)
        self.assertEqual(Reaction.objects.filter(user=user, target_id=str(self.post.pk)).count(), 1)

    def test_racing_toggle_off_decrements_once(self):
        user = make_user('conctoggle')
        Reaction.objects.create(user=user, target_type='post', target_id=str(self.post.pk), kind='like')
        Post.objects.filter(pk=self.post.pk).update(like_count=1)
        clients = [auth_client(user) for _ in range(6)]

        def toggle(client):
            return client.delete('/api/reactions/toggle/', {'target_type': 'post', 'target_id': str(self.post.pk)}, format='json').status_code

        codes = run_threads(toggle, clients)
        self.assertEqual(codes.count(200), 1)
        self.post.refresh_from_db()
        self.assertEqual(self.post.like_count, 0)