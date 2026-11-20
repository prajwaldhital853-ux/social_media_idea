from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.follows.models import Follow

from .models import Post

User = get_user_model()


class PostApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user('alice', password='pw-12345!')
        self.bob = User.objects.create_user('bob', password='pw-12345!')
        self.carol = User.objects.create_user('carol', password='pw-12345!')
        self.public = Post.objects.create(author=self.alice, text='public hello')
        self.private = Post.objects.create(author=self.alice, text='followers only', audience=Post.Audience.FOLLOWERS)
        Follow.objects.create(follower=self.bob, followee=self.alice)

    def ids(self):
        return [p['id'] for p in self.client.get('/api/posts/').data['results']]

    def test_public_post_visible_to_everyone(self):
        res = self.client.get('/api/posts/')
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.public.id, self.ids())
        self.assertEqual(self.client.get(f'/api/posts/{self.public.id}/').status_code, 200)
        for user in (self.bob, self.carol):
            self.client.force_authenticate(user)
            self.assertIn(self.public.id, self.ids())

    def test_followers_only_visibility(self):
        self.assertNotIn(self.private.id, self.ids())
        self.client.force_authenticate(self.carol)
        self.assertNotIn(self.private.id, self.ids())
        self.client.force_authenticate(self.bob)
        self.assertIn(self.private.id, self.ids())
        self.client.force_authenticate(self.alice)
        self.assertIn(self.private.id, self.ids())

    def test_moderation_hidden_not_public(self):
        self.public.status = Post.Status.HIDDEN
        self.public.save()
        self.assertNotIn(self.public.id, self.ids())
        self.client.force_authenticate(self.alice)
        self.assertIn(self.public.id, self.ids())

    def test_create_requires_auth_and_sets_author(self):
        self.assertEqual(self.client.post('/api/posts/', {'text': 'x'}, format='json').status_code, 401)
        self.client.force_authenticate(self.bob)
        res = self.client.post(
            '/api/posts/',
            {'text': 'hi', 'media': [{'kind': 'image', 'url': 'https://example.com/a.png'}]},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['author'], self.bob.id)
        self.assertEqual(res.data['media'][0]['position'], 0)

    def test_delete_only_by_author(self):
        self.assertEqual(self.client.delete(f'/api/posts/{self.public.id}/').status_code, 401)
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.delete(f'/api/posts/{self.public.id}/').status_code, 403)
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f'/api/posts/{self.public.id}/').status_code, 204)
        self.assertFalse(Post.objects.filter(id=self.public.id).exists())

    def test_post_survives_other_users_activity(self):
        self.client.force_authenticate(self.bob)
        comment = self.client.post('/api/comments/', {'post': self.public.id, 'text': 'nice'}, format='json')
        self.client.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.public.id), 'kind': 'love'}, format='json')
        self.client.delete(f"/api/comments/{comment.data['id']}/")
        self.client.force_authenticate(self.carol)
        self.client.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.public.id), 'kind': 'like'}, format='json')
        self.assertTrue(Post.objects.filter(id=self.public.id).exists())
        self.client.force_authenticate(None)
        self.assertIn(self.public.id, self.ids())

    def test_pagination_newest_first(self):
        latest = None
        for i in range(14):
            latest = Post.objects.create(author=self.alice, text=f'p{i}')
        res = self.client.get('/api/posts/')
        self.assertEqual(res.data['count'], 15)
        self.assertEqual(len(res.data['results']), 10)
        self.assertEqual(res.data['results'][0]['id'], latest.id)
        page2 = self.client.get('/api/posts/', {'page': 2})
        self.assertEqual(len(page2.data['results']), 5)
        self.assertIsNone(page2.data['next'])