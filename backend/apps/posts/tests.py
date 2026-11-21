from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Follow
from apps.posts.models import Post, PostMedia


class PostVisibilityTests(TestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('postauthor')
        self.fan = make_user('postfan')
        self.stranger = make_user('poststranger')
        self.public = Post.objects.create(author=self.author, text='public', audience='public')
        self.followers = Post.objects.create(author=self.author, text='followers', audience='followers')

    def test_anonymous_sees_only_public(self):
        resp = APIClient().get('/api/posts/')
        self.assertEqual(resp.status_code, 200)
        texts = {p['text'] for p in resp.data['results']}
        self.assertEqual(texts, {'public'})

    def test_followers_only_requires_accepted_follow(self):
        Follow.objects.create(follower=self.fan, followee=self.author, status='pending')
        resp = auth_client(self.fan).get('/api/posts/')
        self.assertNotIn('followers', {p['text'] for p in resp.data['results']})
        Follow.objects.filter(follower=self.fan, followee=self.author).update(status='accepted')
        resp = auth_client(self.fan).get('/api/posts/')
        self.assertIn('followers', {p['text'] for p in resp.data['results']})
        resp = auth_client(self.stranger).get('/api/posts/')
        self.assertNotIn('followers', {p['text'] for p in resp.data['results']})

    def test_author_sees_own_followers_post(self):
        resp = auth_client(self.author).get('/api/posts/')
        self.assertIn('followers', {p['text'] for p in resp.data['results']})

    def test_author_filter(self):
        resp = auth_client(self.fan).get('/api/posts/?author=postauthor')
        self.assertTrue(all(p['author_username'] == 'postauthor' for p in resp.data['results']))

    def test_media_video_filter(self):
        PostMedia.objects.create(post=self.followers, position=0, kind='video', url='https://cdn.test/v.mp4')
        PostMedia.objects.create(post=self.public, position=0, kind='image', url='https://cdn.test/i.jpg')
        resp = APIClient().get('/api/posts/?media=video')
        self.assertEqual([p['text'] for p in resp.data['results']], [])
        resp = auth_client(self.author).get('/api/posts/?media=video')
        self.assertEqual([p['text'] for p in resp.data['results']], ['followers'])

    def test_card_says_whether_following_needs_approval(self):
        self.author.profile.is_private = True
        self.author.profile.save(update_fields=['is_private'])
        row = APIClient().get('/api/posts/').data['results'][0]
        self.assertTrue(row['author_is_private'])

    def test_only_author_can_delete(self):
        resp = auth_client(self.stranger).delete(f'/api/posts/{self.public.pk}/')
        self.assertIn(resp.status_code, (403, 404))
        resp = auth_client(self.author).delete(f'/api/posts/{self.public.pk}/')
        self.assertEqual(resp.status_code, 204)

    def test_create_with_media_and_counts(self):
        resp = auth_client(self.author).post('/api/posts/', {
            'text': 'with media', 'audience': 'public',
            'media': [{'kind': 'image', 'url': 'https://cdn.test/a.jpg'}, {'kind': 'video', 'url': 'https://cdn.test/b.mp4', 'duration': 4.5}],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(resp.data['media']), 2)
        self.assertEqual(resp.data['like_count'], 0)
        self.assertEqual(resp.data['comment_count'], 0)


class FeedKeysetTests(TestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('feedauthor')
        self.viewer = make_user('feedviewer')
        for i in range(12):
            Post.objects.create(author=self.author, text=f'p{i}', audience='public')

    def test_newest_first_and_stable_pages(self):
        client = auth_client(self.viewer)
        page1 = client.get('/api/feed/')
        self.assertEqual(len(page1.data['results']), 10)
        self.assertEqual(page1.data['results'][0]['text'], 'p11')
        self.assertTrue(page1.data['has_more'])
        page2 = client.get('/api/feed/?cursor=' + page1.data['next_cursor'])
        self.assertEqual([p['text'] for p in page2.data['results']], ['p1', 'p0'])
        Post.objects.create(author=self.author, text='newer', audience='public')
        page2b = client.get('/api/feed/?cursor=' + page1.data['next_cursor'])
        self.assertEqual([p['id'] for p in page2b.data['results']], [p['id'] for p in page2.data['results']])
        self.assertFalse(page2b.data['has_more'])
        self.assertIsNone(page2b.data['next_cursor'])

    def test_following_tab_lists_only_people_you_follow(self):
        client = auth_client(self.viewer)
        self.assertEqual(len(client.get('/api/feed/?following=1').data['results']), 0)
        Follow.objects.create(follower=self.viewer, followee=self.author, status='pending')
        self.assertEqual(len(client.get('/api/feed/?following=1').data['results']), 0)
        Follow.objects.filter(follower=self.viewer, followee=self.author).update(status='accepted')
        page = client.get('/api/feed/?following=1')
        self.assertEqual([p['text'] for p in page.data['results']], ['p11', 'p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2'])
        nxt = client.get('/api/feed/?following=1&cursor=' + page.data['next_cursor'])
        self.assertEqual([p['text'] for p in nxt.data['results']], ['p1', 'p0'])

    def test_following_tab_is_empty_when_nobody_is_signed_in(self):
        self.assertEqual(len(APIClient().get('/api/feed/?following=1').data['results']), 0)


class PostConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('concposter')

    def test_simultaneous_posts_all_persist(self):
        clients = [auth_client(self.author) for _ in range(20)]

        def create(item):
            client, i = item
            return client.post('/api/posts/', {'text': f'concurrent {i}', 'audience': 'public'}, format='json').status_code

        codes = run_threads(create, list(zip(clients, range(20))), workers=10)
        self.assertEqual(codes, [201] * 20)
        self.assertEqual(Post.objects.filter(author=self.author).count(), 20)