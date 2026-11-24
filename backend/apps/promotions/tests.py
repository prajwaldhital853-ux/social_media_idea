from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from apps.common.testutils import auth_client, make_user
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.promotions.services import audience_matches, interest_score, promoted_for
from apps.reactions.models import Reaction
from apps.saved.models import SavedPost
from apps.wallet.models import apply


class PromotionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = make_user('promoowner')
        self.match = make_user('promomatch', date_of_birth='1998-04-12', country='Nepal', city='Kathmandu')
        self.old = make_user('promoold', date_of_birth='1950-01-01', country='Nepal')
        self.foreign = make_user('promoforeign', date_of_birth='1998-04-12', country='India')
        self.post = Post.objects.create(author=self.owner, text='promote me', audience='public', category='Outdoors')
        self.co = auth_client(self.owner)
        apply(self.owner.wallet.pk, 'credit', 1000, 'seed')

    def promote(self, approve=True, **extra):
        """Order a campaign, and by default sign it off the way a seat does, so the
        tests below read a run rather than the queue. The coins move at approval."""
        body = {'target_type': 'post', 'target_id': str(self.post.pk), 'category': 'Outdoors', 'age_min': 18, 'age_max': 40, 'country': 'Nepal', 'budget': 100}
        body.update(extra)
        resp = self.co.post('/api/promotions/', body, format='json')
        if approve and resp.status_code == 201:
            self.sign_off(resp.data['id'])
        return resp

    def sign_off(self, pk):
        promo = Promotion.objects.get(pk=pk)
        promo.status = Promotion.Status.ACTIVE
        promo.starts_at = timezone.now()
        promo.save(update_fields=['status', 'starts_at'])
        if promo.budget:
            apply(promo.owner.wallet.pk, 'debit', promo.budget, f'Promotion {promo.pk} approved')
        return promo

    def test_create_waits_for_a_seat_and_moves_no_coins(self):
        resp = self.promote(approve=False)
        self.assertEqual(resp.status_code, 201)
        self.owner.wallet.refresh_from_db()
        self.assertEqual(self.owner.wallet.balance, Decimal('1000'), 'ordering buys nothing until a seat approves')
        self.assertEqual(resp.data['status'], 'pending')
        feed = auth_client(self.match).get('/api/feed/')
        self.assertTrue(all(not p.get('promoted') for p in feed.data['results']),
                        'an unapproved campaign is not in the feed')

    def test_overdraft_and_foreign_target_rejected(self):
        resp = self.promote(budget=5000)
        self.assertEqual(resp.status_code, 400)
        other_post = Post.objects.create(author=self.match, text='not mine', audience='public')
        resp = self.promote(target_id=str(other_post.pk), budget=10)
        self.assertEqual(resp.status_code, 400)

    def test_a_private_account_cannot_promote(self):
        self.owner.profile.is_private = True
        self.owner.profile.save(update_fields=['is_private'])
        resp = self.promote()
        self.assertEqual(resp.status_code, 400)
        self.owner.wallet.refresh_from_db()
        self.assertEqual(self.owner.wallet.balance, Decimal('1000'), 'a refused promotion costs nothing')

    def test_audience_matching(self):
        promo = Promotion.objects.create(owner=self.owner, target_type='post', target_id=str(self.post.pk), age_min=18, age_max=40, country='Nepal', status='active')
        self.assertTrue(audience_matches(promo, self.match))
        self.assertFalse(audience_matches(promo, self.old))
        self.assertFalse(audience_matches(promo, self.foreign))
        self.assertTrue(audience_matches(promo, self.owner))
        promo.cities = ['Pokhara']
        self.assertFalse(audience_matches(promo, self.match))

    def test_feed_targets_only_matching_users(self):
        self.promote()
        feed_match = auth_client(self.match).get('/api/feed/')
        lead = feed_match.data['results'][0]
        self.assertTrue(lead['promoted'])
        self.assertEqual(lead['id'], self.post.pk)
        for user in (self.old, self.foreign):
            feed = auth_client(user).get('/api/feed/')
            self.assertTrue(all(not p.get('promoted') for p in feed.data['results']))

    def test_promo_only_on_first_page(self):
        self.promote()
        client = auth_client(self.match)
        page1 = client.get('/api/feed/')
        self.assertTrue(page1.data['results'][0]['promoted'])
        if page1.data['next_cursor']:
            page2 = client.get('/api/feed/?cursor=' + page1.data['next_cursor'])
            self.assertTrue(all(not p.get('promoted') for p in page2.data['results']))

    def test_interest_ranking(self):
        engaged = make_user('promoengaged', date_of_birth='1998-04-12', country='Nepal')
        for i in range(3):
            p = Post.objects.create(author=self.owner, text=f'outdoors {i}', audience='public', category='Outdoors')
            Reaction.objects.create(user=engaged, target_type='post', target_id=str(p.pk), kind='like')
            SavedPost.objects.create(user=engaged, post=p)
        low = self.promote(category='Travel', budget=50)
        high = self.promote(category='Outdoors', budget=50)
        self.assertEqual(low.status_code, 201)
        self.assertEqual(high.status_code, 201)
        ranked = promoted_for(engaged)
        self.assertEqual(ranked[0].pk, high.data['id'])
        self.assertGreater(interest_score(engaged, 'Outdoors'), interest_score(engaged, 'Travel'))

    def test_pause_resume_end_transitions(self):
        promo_id = self.promote().data['id']
        resp = self.co.post(f'/api/promotions/{promo_id}/pause/')
        self.assertEqual(resp.data['status'], 'paused')
        feed = auth_client(self.match).get('/api/feed/')
        self.assertTrue(all(not p.get('promoted') for p in feed.data['results']))
        resp = self.co.post(f'/api/promotions/{promo_id}/resume/')
        self.assertEqual(resp.data['status'], 'active')
        resp = self.co.post(f'/api/promotions/{promo_id}/end/')
        self.assertEqual(resp.data['status'], 'ended')
        resp = self.co.post(f'/api/promotions/{promo_id}/resume/')
        self.assertEqual(resp.status_code, 400)

    def test_only_owner_manages_promotion(self):
        promo_id = self.promote().data['id']
        resp = auth_client(self.match).post(f'/api/promotions/{promo_id}/pause/')
        self.assertEqual(resp.status_code, 404)
        resp = auth_client(self.match).get('/api/promotions/')
        self.assertEqual(resp.data['results'], [])