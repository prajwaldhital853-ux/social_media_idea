from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.common.testutils import auth_client, make_user, staff_client
from apps.follows.models import Follow
from apps.posts.models import Post


class ProfileTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = make_user('profileowner')
        self.viewer = make_user('profileviewer')
        self.co = auth_client(self.owner)
        Post.objects.create(author=self.owner, text='p1', audience='public')

    def test_public_profile_with_counts(self):
        resp = APIClient().get('/api/profiles/profileowner/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['locked'])
        self.assertEqual(resp.data['posts'], 1)
        self.assertEqual(resp.data['followers'], 0)
        self.assertIn('bio', resp.data)

    def test_private_profile_locked_until_accepted(self):
        self.owner.profile.is_private = True
        self.owner.profile.save()
        resp = auth_client(self.viewer).get('/api/profiles/profileowner/')
        self.assertTrue(resp.data['locked'])
        self.assertNotIn('bio', resp.data)
        Follow.objects.create(follower=self.viewer, followee=self.owner, status='pending')
        resp = auth_client(self.viewer).get('/api/profiles/profileowner/')
        self.assertTrue(resp.data['locked'])
        Follow.objects.filter(follower=self.viewer, followee=self.owner).update(status='accepted')
        resp = auth_client(self.viewer).get('/api/profiles/profileowner/')
        self.assertFalse(resp.data['locked'])
        self.assertIn('bio', resp.data)

    def test_owner_and_staff_see_full_private_profile(self):
        self.owner.profile.is_private = True
        self.owner.profile.save()
        self.assertFalse(self.co.get('/api/profiles/profileowner/').data['locked'])

    def test_patch_own_profile_only(self):
        resp = auth_client(self.viewer).patch('/api/profiles/profileowner/', {'bio': 'hacked'}, format='json')
        self.assertEqual(resp.status_code, 403)
        resp = self.co.patch('/api/profiles/profileowner/', {
            'bio': 'Trail runner', 'name': 'Profile Owner', 'dob': '1995-06-15', 'country': 'Nepal', 'city': 'Pokhara', 'cover_url': 'https://cdn.test/cover.jpg',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.owner.refresh_from_db()
        self.owner.profile.refresh_from_db()
        self.assertEqual(self.owner.profile.bio, 'Trail runner')
        self.assertEqual(str(self.owner.date_of_birth), '1995-06-15')
        self.assertEqual(self.owner.city, 'Pokhara')

    def test_counts_reflect_accepted_follows_only(self):
        Follow.objects.create(follower=self.viewer, followee=self.owner, status='accepted')
        pending_user = make_user('profilepending')
        Follow.objects.create(follower=pending_user, followee=self.owner, status='pending')
        Post.objects.create(author=self.owner, text='taken down', status='hidden')
        resp = APIClient().get('/api/profiles/profileowner/')
        self.assertEqual(resp.data['followers'], 1)
        self.assertEqual(resp.data['posts'], 1)

    def test_every_card_reports_the_same_counts_as_the_profile(self):
        """The profile, the search card, the sync graph and the admin roster all
        show a follower and post number; a pending request or a moderated post
        must not make one of them disagree with the profile page."""
        Follow.objects.create(follower=self.viewer, followee=self.owner, status='accepted')
        pending_user = make_user('cardpending')
        Follow.objects.create(follower=pending_user, followee=self.owner, status='pending')
        Post.objects.create(author=self.owner, text='taken down', status='hidden')

        search = auth_client(pending_user).get('/api/users/?q=profileowner').data['results']
        card = next(c for c in search if c['username'] == 'profileowner')
        self.assertEqual((card['followers'], card['posts']), (1, 1))

        people = auth_client(self.viewer).get('/api/sync/').data['people']
        graph = next(c for c in people if c['username'] == 'profileowner')
        self.assertEqual(graph['followers'], 1)

        roster = staff_client().get('/api/moderation/users/').data['results']
        admin_card = next(c for c in roster if c['username'] == 'profileowner')
        self.assertEqual((admin_card['followers'], admin_card['posts']), (1, 1))