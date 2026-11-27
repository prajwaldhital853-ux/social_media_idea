from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from apps.common.testutils import auth_client, make_user, run_threads
from apps.adminpanel.models import AdminSetting
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
        # A stranger gets no card at all: there is nothing of a private account
        # in their feed to annotate.
        self.assertEqual(APIClient().get('/api/posts/').data['results'], [])
        # An accepted follower does see it, and the card still says the account
        # is private so the follow button knows there is no pending state to show.
        Follow.objects.create(follower=self.fan, followee=self.author, status='accepted')
        rows = auth_client(self.fan).get('/api/posts/').data['results']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['author_is_private'] for row in rows))

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

    def test_for_you_is_newest_first_and_survives_a_reload(self):
        client = auth_client(self.viewer)
        page1 = client.get('/api/feed/')
        self.assertEqual(len(page1.data['results']), 10)
        # For You lists every public post newest first, and the order is the
        # same on every read: a refresh or a reopen opens on the same screenful.
        self.assertEqual([p['text'] for p in page1.data['results']],
                         [f'p{i}' for i in range(11, 1, -1)])
        again = client.get('/api/feed/')
        self.assertEqual([p['text'] for p in page1.data['results']],
                         [p['text'] for p in again.data['results']],
                         'a reload moved the rows a reader was already reading')
        self.assertTrue(page1.data['has_more'])
        page2 = client.get('/api/feed/?cursor=' + page1.data['next_cursor'])
        self.assertEqual([p['text'] for p in page2.data['results']], ['p1', 'p0'])
        Post.objects.create(author=self.author, text='newer', audience='public')
        page2b = client.get('/api/feed/?cursor=' + page1.data['next_cursor'])
        self.assertEqual([p['id'] for p in page2b.data['results']], [p['id'] for p in page2.data['results']])
        self.assertFalse(page2b.data['has_more'])
        self.assertIsNone(page2b.data['next_cursor'])
        fresh = client.get('/api/feed/')
        self.assertEqual(fresh.data['results'][0]['text'], 'newer',
                         'a post that arrived after the last visit takes the top')

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


class ShareCountTests(TestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('shareauthor')
        self.fan = make_user('sharefan')
        self.public = Post.objects.create(author=self.author, text='shareable', audience='public')
        self.hidden = Post.objects.create(author=self.author, text='private', audience='followers')

    def test_a_share_raises_the_tally_and_the_card_reports_it(self):
        client = auth_client(self.fan)
        self.assertEqual(client.get('/api/posts/').data['results'][0]['share_count'], 0)
        resp = client.post(f'/api/posts/{self.public.pk}/share/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['share_count'], 1)
        self.assertEqual(Post.objects.get(pk=self.public.pk).share_count, 1)
        client.post(f'/api/posts/{self.public.pk}/share/')
        self.assertEqual(Post.objects.get(pk=self.public.pk).share_count, 2)

    def test_a_guest_can_share_a_public_post(self):
        self.assertEqual(APIClient().post(f'/api/posts/{self.public.pk}/share/').status_code, 200)

    def test_sharing_something_you_cannot_read_is_a_404(self):
        resp = APIClient().post(f'/api/posts/{self.hidden.pk}/share/')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(Post.objects.get(pk=self.hidden.pk).share_count, 0)


class ShareConcurrencyTests(TransactionTestCase):
    """Threads get their own database connection, so this needs committed rows."""

    def setUp(self):
        cache.clear()
        self.author = make_user('shareconcauthor')
        self.fan = make_user('shareconcfan')
        self.post = Post.objects.create(author=self.author, text='viral', audience='public')

    def test_twenty_sharers_at_once_all_count(self):
        clients = [auth_client(self.fan) for _ in range(20)]

        def hit(item):
            client, _ = item
            return client.post(f'/api/posts/{self.post.pk}/share/').status_code

        codes = run_threads(hit, list(zip(clients, range(20))), workers=10)
        self.assertEqual(codes, [200] * 20)
        self.assertEqual(Post.objects.get(pk=self.post.pk).share_count, 20)


class PostConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('concposter')
        # Twenty posts from one account is what a race needs, not what a person
        # does, so the spam desk's hourly ceiling is switched off for this test
        # the way a seat would switch it off: a zero, not a bigger number.
        AdminSetting.objects.create(key='spam_post_per_hour', value='0')

    def test_simultaneous_posts_all_persist(self):
        clients = [auth_client(self.author) for _ in range(20)]

        def create(item):
            client, i = item
            return client.post('/api/posts/', {'text': f'concurrent {i}', 'audience': 'public'}, format='json').status_code

        codes = run_threads(create, list(zip(clients, range(20))), workers=10)
        self.assertEqual(codes, [201] * 20)
        self.assertEqual(Post.objects.filter(author=self.author).count(), 20)


class ReelViewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.author = make_user('viewauthor')
        self.fan = make_user('viewfan')
        self.reels = []
        for i, n in enumerate([5, 40, 15]):
            post = Post.objects.create(author=self.author, text=f'reel {i}', audience='public')
            PostMedia.objects.create(post=post, kind='video', url='https://x.test/a.mp4', position=0)
            post.views = n
            post.save(update_fields=['views'])
            self.reels.append(post)
        self.photo = Post.objects.create(author=self.author, text='a photo post', audience='public')
        PostMedia.objects.create(post=self.photo, kind='image', url='https://x.test/a.jpg', position=0)
        self.hidden = Post.objects.create(author=self.author, text='backroom', audience='followers')
        self.cc = auth_client(self.fan)

    def _ids(self, url):
        return [row['id'] for row in self.cc.get(url).data['results']]

    def test_a_watched_reel_counts_and_reports_the_total(self):
        resp = self.cc.post(f'/api/posts/{self.reels[0].pk}/view/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['views'], 6)
        self.cc.post(f'/api/posts/{self.reels[0].pk}/view/')
        self.assertEqual(Post.objects.get(pk=self.reels[0].pk).views, 7)

    def test_most_views_sorts_the_reel_shelf_and_skips_photo_posts(self):
        ids = self._ids('/api/posts/?media=video&order=views')
        self.assertEqual(ids, [self.reels[1].pk, self.reels[2].pk, self.reels[0].pk])
        self.assertNotIn(self.photo.pk, ids)

    def test_latest_and_oldest_are_two_walks_of_the_same_shelf(self):
        latest = self._ids('/api/posts/?media=video&order=latest')
        self.assertEqual(latest, list(reversed(self._ids('/api/posts/?media=video&order=oldest'))))

    def test_the_views_page_walks_a_cursor_of_counts(self):
        # Twelve reels, so the most-viewed shelf has to break into a second page
        # and the cursor has to carry a count instead of a timestamp.
        for i in range(9):
            post = Post.objects.create(author=self.author, text=f'more {i}', audience='public')
            PostMedia.objects.create(post=post, kind='video', url='https://x.test/b.mp4', position=0)
            post.views = 100 + i
            post.save(update_fields=['views'])
        first = self.cc.get('/api/posts/?media=video&order=views').data
        self.assertEqual(len(first['results']), 10)
        self.assertTrue(first['has_more'])
        second = self.cc.get(f'/api/posts/?media=video&order=views&cursor={first["next_cursor"]}').data
        rows = first['results'] + second['results']
        self.assertEqual(len(second['results']), 2)
        self.assertEqual(len({row['id'] for row in rows}), 12)
        counts = [row['views'] for row in rows]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_counting_a_view_you_cannot_watch_is_a_404(self):
        self.assertEqual(APIClient().post(f'/api/posts/{self.hidden.pk}/view/').status_code, 404)
        self.assertEqual(Post.objects.get(pk=self.hidden.pk).views, 0)

    def test_the_card_carries_its_own_tally(self):
        row = self.cc.get(f'/api/posts/{self.reels[0].pk}/').data
        self.assertEqual(row['views'], 5)
        self.assertEqual(row['share_count'], 0)
