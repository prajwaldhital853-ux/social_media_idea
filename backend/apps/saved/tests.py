from django.core.cache import cache
from django.test import TestCase

from apps.common.testutils import auth_client, make_user
from apps.follows.models import Follow
from apps.marketplace.models import Listing
from apps.posts.models import Post
from apps.saved.models import SavedListing, SavedPost


class SavedTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = make_user('savedowner')
        self.saver = make_user('savedsaver')
        self.post = Post.objects.create(author=self.owner, text='save me', audience='public')
        self.listing = Listing.objects.create(seller=self.owner, title='Save this boat', price=100, category='Outdoors')
        self.cs = auth_client(self.saver)

    def test_save_and_unsave_post(self):
        resp = self.cs.post('/api/saved/posts/', {'post': self.post.pk}, format='json')
        self.assertEqual(resp.status_code, 201)
        resp = self.cs.post('/api/saved/posts/', {'post': self.post.pk}, format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.cs.get('/api/saved/posts/')
        self.assertEqual([p['id'] for p in resp.data['results']], [self.post.pk])
        resp = self.cs.delete(f'/api/saved/posts/{self.post.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(SavedPost.objects.filter(user=self.saver).exists())
        resp = self.cs.delete(f'/api/saved/posts/{self.post.pk}/')
        self.assertEqual(resp.status_code, 404)

    def test_save_and_unsave_listing(self):
        resp = self.cs.post('/api/saved/listings/', {'listing': self.listing.pk}, format='json')
        self.assertEqual(resp.status_code, 201)
        resp = self.cs.get('/api/saved/listings/')
        self.assertEqual([l['id'] for l in resp.data['results']], [self.listing.pk])
        resp = self.cs.delete(f'/api/saved/listings/{self.listing.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(SavedListing.objects.filter(user=self.saver).exists())

    def test_removed_content_hidden_from_saved(self):
        self.cs.post('/api/saved/posts/', {'post': self.post.pk}, format='json')
        self.cs.post('/api/saved/listings/', {'listing': self.listing.pk}, format='json')
        Post.objects.filter(pk=self.post.pk).update(status='removed')
        Listing.objects.filter(pk=self.listing.pk).update(status='removed')
        self.assertEqual(self.cs.get('/api/saved/posts/').data['results'], [])
        self.assertEqual(self.cs.get('/api/saved/listings/').data['results'], [])

    def test_saved_lists_are_per_user(self):
        self.cs.post('/api/saved/posts/', {'post': self.post.pk}, format='json')
        other = auth_client(make_user('savedother'))
        self.assertEqual(other.get('/api/saved/posts/').data['results'], [])

    def test_a_save_is_a_bookmark_not_a_permission(self):
        """Unfollowing closes a followers-only post, even one already bookmarked."""
        secret = Post.objects.create(author=self.owner, text='for my followers', audience='followers')
        Follow.objects.create(follower=self.saver, followee=self.owner)
        self.assertEqual(self.cs.post('/api/saved/posts/', {'post': secret.pk}, format='json').status_code, 201)
        self.assertIn(secret.pk, [p['id'] for p in self.cs.get('/api/saved/posts/').data['results']])
        Follow.objects.filter(follower=self.saver, followee=self.owner).delete()
        self.assertNotIn(secret.pk, [p['id'] for p in self.cs.get('/api/saved/posts/').data['results']])
        outsider = auth_client(make_user('savedoutsider'))
        self.assertEqual(outsider.post('/api/saved/posts/', {'post': secret.pk}, format='json').status_code, 404)