from django.core.cache import cache
from django.test import TestCase, TransactionTestCase

from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Follow
from apps.posts.models import Post, PostMedia
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

class ReactorListTests(TestCase):
    """The sheet behind a card's reaction row: who, in what order, one page at a time."""

    def setUp(self):
        cache.clear()
        self.viewer = make_user('rlviewer')
        self.followed = make_user('rlfollowed')
        self.stranger = make_user('rlstranger')
        self.client_user = auth_client(self.viewer)
        Follow.objects.create(follower=self.viewer, followee=self.followed, status='accepted')
        self.post = Post.objects.create(author=self.stranger, text='reactors', audience='public')

    def add(self, user, kind='like', target_type='post', target_id=None):
        Reaction.objects.create(
            user=user, target_type=target_type,
            target_id=str(self.post.pk if target_id is None else target_id), kind=kind,
        )

    def people(self, **params):
        query = {'target_type': 'post', 'target_id': str(self.post.pk), **params}
        return self.client_user.get('/api/reactions/people/', query)

    def test_leads_with_me_then_followed_then_others(self):
        self.add(self.stranger)
        self.add(self.followed)
        self.add(self.viewer, kind='love')
        rows = self.people().data['results']
        self.assertEqual([r['username'] for r in rows], ['rlviewer', 'rlfollowed', 'rlstranger'])
        self.assertTrue(rows[0]['me'])
        self.assertTrue(rows[1]['followed'])
        self.assertFalse(rows[2]['followed'])
        self.assertEqual(rows[0]['kind'], 'love')

    def test_pages_walk_the_list_without_repeats(self):
        crowd = [make_user(f'rlcrowd{i}') for i in range(14)]
        for person in crowd:
            self.add(person)
        seen, cursor, pages = [], None, 0
        while True:
            resp = self.people(**({'cursor': cursor} if cursor else {}))
            page = resp.data['results']
            seen += [r['username'] for r in page]
            cursor = resp.data['next']
            pages += 1
            if not cursor:
                break
            self.assertLess(pages, 10, 'the cursor is not advancing')
        self.assertEqual(len(seen), 14)
        self.assertEqual(len(set(seen)), 14)
        self.assertEqual(pages, 2)

    def test_kind_narrows_the_page_and_counts_stay_whole(self):
        self.add(self.followed, kind='love')
        self.add(self.stranger, kind='love')
        self.add(self.viewer, kind='wow')
        data = self.people(kind='love').data
        self.assertEqual(sorted(r['username'] for r in data['results']), ['rlfollowed', 'rlstranger'])
        self.assertEqual(data['counts'], {'love': 2, 'wow': 1})
        self.assertEqual(data['total'], 3)

    def test_a_photo_reaction_is_one_person_not_two(self):
        media = PostMedia.objects.create(post=self.post, position=0, kind='image', url='https://example.test/a.jpg')
        self.add(self.followed, kind='like')
        self.add(self.followed, kind='love', target_type='media', target_id=f'{self.post.pk}#m0')
        rows = self.people().data['results']
        self.assertEqual([r['username'] for r in rows], ['rlfollowed'])
        self.assertEqual(self.people(kind='love').data['results'][0]['kind'], 'love')

    def test_an_unreadable_post_answers_with_nothing(self):
        self.stranger.profile.is_private = True
        self.stranger.profile.save(update_fields=['is_private'])
        outsider = auth_client(make_user('rloutsider'))
        resp = outsider.get('/api/reactions/people/', {'target_type': 'post', 'target_id': str(self.post.pk)})
        self.assertEqual(resp.status_code, 404)

    def test_the_card_preview_names_the_same_people_in_the_same_order(self):
        self.add(self.stranger)
        self.add(self.followed)
        self.add(self.viewer, kind='love')
        for extra in (make_user('rlmore1'), make_user('rlmore2')):
            self.add(extra)
        people = self.client_user.get(f'/api/posts/{self.post.pk}/').data['reaction_people']
        self.assertEqual(len(people), 3, 'a card prints three names and no more')
        self.assertEqual([p['name'] for p in people[:2]], ['rlviewer', 'rlfollowed'])
        self.assertEqual(people[0]['kind'], 'love')
        self.assertTrue(people[0]['me'])
        self.assertFalse(people[1]['me'])
        self.assertFalse(people[2]['me'])

    def test_the_preview_merges_the_photos_of_a_multi_image_post(self):
        PostMedia.objects.create(post=self.post, position=0, kind='image', url='https://example.test/a.jpg')
        friend = make_user('rlfriend')
        Follow.objects.create(follower=self.viewer, followee=friend, status='accepted')
        self.add(friend, kind='love', target_type='media', target_id=f'{self.post.pk}#m0')
        self.add(self.stranger)
        people = self.client_user.get(f'/api/posts/{self.post.pk}/').data['reaction_people']
        self.assertEqual([p['name'] for p in people], ['rlfriend', 'rlstranger'])

    def test_a_card_prints_a_person_once(self):
        PostMedia.objects.create(post=self.post, position=0, kind='image', url='https://example.test/a.jpg')
        self.add(self.followed, kind='like')
        self.add(self.followed, kind='love', target_type='media', target_id=f'{self.post.pk}#m0')
        self.add(self.stranger)
        people = self.client_user.get(f'/api/posts/{self.post.pk}/').data['reaction_people']
        self.assertEqual([p['name'] for p in people], ['rlfollowed', 'rlstranger'])
