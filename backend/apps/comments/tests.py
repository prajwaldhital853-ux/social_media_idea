from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.posts.models import Post

from .models import Comment

User = get_user_model()


class CommentApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user('alice', password='pw-12345!')
        self.bob = User.objects.create_user('bob', password='pw-12345!')
        self.post = Post.objects.create(author=self.alice, text='hello')
        self.other = Post.objects.create(author=self.alice, text='other')

    def test_anonymous_can_read_comments(self):
        Comment.objects.create(post=self.post, author=self.bob, text='first')
        res = self.client.get('/api/comments/', {'post': self.post.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['count'], 1)

    def test_create_requires_auth_and_sets_author(self):
        self.assertEqual(self.client.post('/api/comments/', {'post': self.post.id, 'text': 'x'}, format='json').status_code, 401)
        self.client.force_authenticate(self.bob)
        res = self.client.post('/api/comments/', {'post': self.post.id, 'text': 'nice'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['author'], self.bob.id)

    def test_reply_must_match_post(self):
        parent = Comment.objects.create(post=self.post, author=self.bob, text='parent')
        self.client.force_authenticate(self.bob)
        res = self.client.post('/api/comments/', {'post': self.other.id, 'parent': parent.id, 'text': 'bad'}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/comments/', {'post': self.post.id, 'parent': parent.id, 'text': 'good'}, format='json')
        self.assertEqual(res.status_code, 201)

    def test_delete_only_by_author(self):
        comment = Comment.objects.create(post=self.post, author=self.bob, text='mine')
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f'/api/comments/{comment.id}/').status_code, 403)
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.delete(f'/api/comments/{comment.id}/').status_code, 204)
        self.assertFalse(Comment.objects.filter(id=comment.id).exists())

    def test_comments_persist_until_author_removes(self):
        comment = Comment.objects.create(post=self.post, author=self.bob, text='stays')
        self.client.force_authenticate(self.alice)
        self.client.post('/api/reactions/', {'target_type': 'comment', 'target_id': str(comment.id), 'kind': 'like'}, format='json')
        self.client.delete(f'/api/posts/{self.other.id}/')
        self.assertTrue(Comment.objects.filter(id=comment.id).exists())

    def test_pagination_newest_first(self):
        latest = None
        for i in range(12):
            latest = Comment.objects.create(post=self.post, author=self.bob, text=f'c{i}')
        res = self.client.get('/api/comments/', {'post': self.post.id})
        self.assertEqual(res.data['count'], 12)
        self.assertEqual(len(res.data['results']), 10)
        self.assertEqual(res.data['results'][0]['id'], latest.id)
        page2 = self.client.get('/api/comments/', {'post': self.post.id, 'page': 2})
        self.assertEqual(len(page2.data['results']), 2)