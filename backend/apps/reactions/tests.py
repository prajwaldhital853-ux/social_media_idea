from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework.test import APITestCase

from apps.posts.models import Post

from .models import Reaction

User = get_user_model()


class ReactionApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user('alice', password='pw-12345!')
        self.bob = User.objects.create_user('bob', password='pw-12345!')
        self.post = Post.objects.create(author=self.alice, text='hello')

    def react(self, kind, user=None):
        self.client.force_authenticate(user or self.bob)
        return self.client.post(
            '/api/reactions/',
            {'target_type': 'post', 'target_id': str(self.post.id), 'kind': kind},
            format='json',
        )

    def test_create_requires_auth(self):
        self.assertEqual(
            self.client.post('/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.id), 'kind': 'like'}, format='json').status_code,
            401,
        )

    def test_one_reaction_per_user_per_post(self):
        self.assertEqual(self.react('like').status_code, 201)
        res = self.react('love')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['kind'], 'love')
        self.assertEqual(Reaction.objects.filter(user=self.bob, target_type='post', target_id=str(self.post.id)).count(), 1)

    def test_unique_constraint_at_db_level(self):
        Reaction.objects.create(user=self.bob, target_type='post', target_id=str(self.post.id), kind='like')
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Reaction.objects.create(user=self.bob, target_type='post', target_id=str(self.post.id), kind='love')

    def test_different_users_each_react(self):
        self.react('like', self.bob)
        self.react('wow', self.alice)
        res = self.client.get('/api/reactions/', {'target_type': 'post', 'target_id': str(self.post.id)})
        self.assertEqual(res.data['count'], 2)

    def test_delete_only_by_owner(self):
        self.react('like')
        reaction = Reaction.objects.get(user=self.bob)
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f'/api/reactions/{reaction.id}/').status_code, 403)
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.delete(f'/api/reactions/{reaction.id}/').status_code, 204)
        self.assertEqual(Reaction.objects.count(), 0)

    def test_reactions_persist_until_user_removes(self):
        self.react('like')
        self.client.force_authenticate(self.alice)
        self.client.post('/api/comments/', {'post': self.post.id, 'text': 'hi'}, format='json')
        self.assertEqual(Reaction.objects.count(), 1)

    def test_media_and_comment_targets_independent(self):
        self.react('like')
        self.client.force_authenticate(self.bob)
        res = self.client.post('/api/reactions/', {'target_type': 'media', 'target_id': f'{self.post.id}#m0', 'kind': 'love'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Reaction.objects.filter(user=self.bob).count(), 2)