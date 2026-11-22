from django.core.cache import cache
from django.test import TestCase, TransactionTestCase

from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Follow
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

    def test_reactions_follow_the_posts_visibility(self):
        self.author.profile.is_private = True
        self.author.profile.save(update_fields=['is_private'])
        stranger = auth_client(make_user('reactstranger'))
        self.assertEqual(self.react(client=stranger).status_code, 404)
        self.assertEqual(
            Reaction.objects.filter(target_type='post', target_id=str(self.post.pk)).count(), 0,
        )
        rows = stranger.get(f'/api/reactions/?target_type=post&target_id={self.post.pk}').data['results']
        self.assertEqual(rows, [])
        Follow.objects.create(follower=self.fan, followee=self.author, status='accepted')
        self.assertEqual(self.react().status_code, 201)
        rows = self.cf.get(f'/api/reactions/?target_type=post&target_id={self.post.pk}').data['results']
        self.assertEqual([r['username'] for r in rows], ['reactfan'])

    def test_reaction_notifies_author_not_self(self):
        self.react()
        self.assertEqual(self.author.notifications.count(), 1)
        ca = auth_client(self.author)
        ca.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.pk), 'kind': 'like'}, format='json')
        self.assertEqual(self.author.notifications.count(), 1)

    def test_post_payload_carries_the_per_kind_reaction_mix(self):
        from apps.posts.models import PostMedia

        other = auth_client(make_user('reactother'))
        third = auth_client(make_user('reactthird'))
        PostMedia.objects.create(post=self.post, kind='image', url='https://example.com/a.jpg', position=0)
        self.react('like')
        self.react(client=other)
        third.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.pk), 'kind': 'wow'}, format='json')
        other.post('/api/reactions/', {'target_type': 'media', 'target_id': f'{self.post.pk}#m0', 'kind': 'haha'}, format='json')

        row = next(r for r in self.cf.get('/api/posts/').data['results'] if str(r['id']) == str(self.post.pk))
        self.assertEqual(row['reaction_kinds'], {'like': 2, 'wow': 1})
        self.assertEqual(row['media_reaction_kinds'], {'0': {'haha': 1}})
        self.assertEqual(row['like_count'], 3)
        self.assertEqual(row['my_reaction'], 'like')

        # Signed-out readers still see how the post landed, never whose.
        arow = next(r for r in self.client.get('/api/posts/').data['results'] if str(r['id']) == str(self.post.pk))
        self.assertEqual(arow['reaction_kinds'], {'like': 2, 'wow': 1})
        self.assertEqual(arow['media_reaction_kinds'], {'0': {'haha': 1}})
        self.assertIsNone(arow['my_reaction'])


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