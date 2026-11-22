from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from apps.comments.models import Comment
from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Follow
from apps.notifications.models import Notification
from apps.posts.models import Post


class CommentTests(TestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('commentauthor')
        self.commenter = make_user('commenter')
        self.post = Post.objects.create(author=self.author, text='target', audience='public')
        self.ca = auth_client(self.author)
        self.cc = auth_client(self.commenter)

    def test_comment_and_reply_update_counter_and_notify(self):
        resp = self.cc.post('/api/comments/', {'post': self.post.pk, 'text': 'root'}, format='json')
        self.assertEqual(resp.status_code, 201)
        root = resp.data['id']
        resp = self.ca.post('/api/comments/', {'post': self.post.pk, 'text': 'reply', 'parent': root}, format='json')
        self.assertEqual(resp.status_code, 201)
        self.post.refresh_from_db()
        self.assertEqual(self.post.comment_count, 2)
        self.assertTrue(Notification.objects.filter(recipient=self.author, kind='comment').exists())
        self.assertTrue(Notification.objects.filter(recipient=self.commenter, kind='reply').exists())

    def test_delete_parent_removes_replies_from_counter(self):
        root = Comment.objects.create(post=self.post, author=self.commenter, text='root')
        Comment.objects.create(post=self.post, author=self.author, text='r1', parent=root)
        Comment.objects.create(post=self.post, author=self.author, text='r2', parent=root)
        Post.objects.filter(pk=self.post.pk).update(comment_count=3)
        resp = self.cc.delete(f'/api/comments/{root.pk}/')
        self.assertEqual(resp.status_code, 204)
        self.post.refresh_from_db()
        self.assertEqual(self.post.comment_count, 0)
        self.assertEqual(Comment.objects.filter(post=self.post).count(), 0)

    def test_only_author_can_delete(self):
        root = Comment.objects.create(post=self.post, author=self.commenter, text='root')
        resp = self.ca.delete(f'/api/comments/{root.pk}/')
        self.assertIn(resp.status_code, (403, 404))

    def test_filter_by_post_parent_and_media_index(self):
        root = Comment.objects.create(post=self.post, author=self.commenter, text='root')
        Comment.objects.create(post=self.post, author=self.author, text='reply', parent=root)
        Comment.objects.create(post=self.post, author=self.author, text='on media', media_index=1)
        resp = self.cc.get(f'/api/comments/?post={self.post.pk}&parent={root.pk}')
        self.assertEqual([c['text'] for c in resp.data['results']], ['reply'])
        resp = self.cc.get(f'/api/comments/?post={self.post.pk}&media_index=1')
        self.assertEqual([c['text'] for c in resp.data['results']], ['on media'])

    def test_top_level_stream_excludes_replies(self):
        root = Comment.objects.create(post=self.post, author=self.commenter, text='root')
        Comment.objects.create(post=self.post, author=self.author, text='reply', parent=root)
        Comment.objects.create(post=self.post, author=self.author, text='second')
        resp = self.cc.get(f'/api/comments/?post={self.post.pk}&top=1')
        self.assertEqual([c['text'] for c in resp.data['results']], ['second', 'root'])

    def test_private_authors_thread_follows_the_post_rule(self):
        self.author.profile.is_private = True
        self.author.profile.save(update_fields=['is_private'])
        Comment.objects.create(post=self.post, author=self.commenter, text='inside')
        fan = make_user('threadfan')
        Follow.objects.create(follower=fan, followee=self.author, status='accepted')

        rows = auth_client(fan).get(f'/api/comments/?post={self.post.pk}&top=1').data['results']
        self.assertEqual([c['text'] for c in rows], ['inside'])
        rows = self.ca.get(f'/api/comments/?post={self.post.pk}&top=1').data['results']
        self.assertEqual([c['text'] for c in rows], ['inside'])

        stranger = auth_client(make_user('threadstranger'))
        rows = stranger.get(f'/api/comments/?post={self.post.pk}&top=1').data['results']
        self.assertEqual(rows, [])
        resp = stranger.post('/api/comments/', {'post': self.post.pk, 'text': 'hello'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            APIClient().get(f'/api/comments/?post={self.post.pk}&top=1').data['results'], []
        )

    def test_your_own_comment_stays_reachable_after_you_lose_the_post(self):
        root = Comment.objects.create(post=self.post, author=self.commenter, text='from before')
        Post.objects.filter(pk=self.post.pk).update(comment_count=1)
        self.author.profile.is_private = True
        self.author.profile.save(update_fields=['is_private'])
        # The commenter is not a follower, yet the row they wrote is theirs: they
        # can still read it and delete it rather than be stuck with it forever.
        rows = self.cc.get(f'/api/comments/?post={self.post.pk}&top=1').data['results']
        self.assertEqual([c['text'] for c in rows], ['from before'])
        self.assertEqual(self.cc.delete(f'/api/comments/{root.pk}/').status_code, 204)


class CommentConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('conccomauthor')
        self.post = Post.objects.create(author=self.author, text='hot post', audience='public')

    def test_simultaneous_comments_keep_counter_exact(self):
        users = [make_user(f'conccom{i}') for i in range(20)]
        clients = [auth_client(u) for u in users]

        def comment(item):
            client, i = item
            return client.post('/api/comments/', {'post': self.post.pk, 'text': f'c{i}'}, format='json').status_code

        codes = run_threads(comment, list(zip(clients, range(20))), workers=10)
        self.assertEqual(codes, [201] * 20)
        self.post.refresh_from_db()
        self.assertEqual(self.post.comment_count, 20)
        self.assertEqual(Comment.objects.filter(post=self.post).count(), 20)