from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from apps.common.testutils import auth_client, make_user
from apps.posts.models import Post
from apps.promotions.models import Promotion, PromoImpression
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
        for i in range(6):
            Post.objects.create(author=self.owner, text=f'filler {i}', audience='public')
        self.promote()
        feed_match = auth_client(self.match).get('/api/feed/')
        rows = feed_match.data['results']
        # The card waits out the gap the desk set, so the page opens with ordinary
        # posts and the advert takes its place in the middle of the walk.
        self.assertFalse(rows[0].get('promoted'))
        paid_at = next(i for i, r in enumerate(rows) if r.get('promoted'))
        self.assertEqual(paid_at, 4, 'the card lands mid-feed, not over the page')
        self.assertEqual(rows[paid_at]['id'], self.post.pk)
        self.assertEqual(PromoImpression.objects.filter(viewer=self.match).count(), 1)
        # The audience buys placement and metering, not the label: someone outside
        # it meets the post in the ordinary walk still wearing its disclosure, but
        # nothing was written against their name.
        for user in (self.old, self.foreign):
            feed = auth_client(user).get('/api/feed/')
            self.assertEqual([r['id'] for r in feed.data['results'] if r.get('promoted')],
                             [self.post.pk], 'the label follows the row for everyone')
            self.assertEqual(PromoImpression.objects.filter(viewer=user).count(), 0,
                             'no paid slot was metered to someone the campaign does not fit')

    def test_a_campaign_meets_a_person_until_the_daily_cap_is_spent(self):
        for i in range(21):
            Post.objects.create(author=self.owner, text=f'filler {i}', audience='public')
        self.promote()
        client = auth_client(self.match)
        # The desk's daily cap is two showings, so the campaign holds a paid card on
        # this person's first two pages — the same advert, mid-feed again — and then
        # its seats for today are spent.
        first = client.get('/api/feed/')
        self.assertEqual([r['id'] for r in first.data['results'] if r.get('promoted')], [self.post.pk])
        second = client.get('/api/feed/?cursor=' + first.data['next_cursor'])
        self.assertEqual([r['id'] for r in second.data['results'] if r.get('promoted')], [self.post.pk])
        self.assertEqual(PromoImpression.objects.filter(viewer=self.match).count(), 2)
        # Cap spent: no more paid cards. The post sinks back into the ordinary walk
        # and keeps its label there — an unlabelled copy is how a promotion ends up
        # reading to its own payer as a chronological feed.
        third = client.get('/api/feed/?cursor=' + second.data['next_cursor'])
        walk = [r for r in third.data['results'] if r['id'] == self.post.pk]
        self.assertTrue(walk and walk[0]['promoted'], 'a served campaign stays disclosed')
        self.assertFalse(any(r.get('promoted') and r['id'] != self.post.pk
                             for r in third.data['results']))
        self.assertEqual(PromoImpression.objects.filter(viewer=self.match).count(), 2)

    def test_the_repeat_dial_ends_one_campaign_while_the_day_has_room(self):
        from apps.adminpanel import settings_store
        from apps.promotions.services import candidates
        settings_store.write(None, {'promo_repeat_limit': 1, 'promo_daily_cap': 5})
        for i in range(20):
            Post.objects.create(author=self.owner, text=f'filler {i}', audience='public')
        self.promote()
        client = auth_client(self.match)
        first = client.get('/api/feed/')
        self.assertEqual([r['id'] for r in first.data['results'] if r.get('promoted')], [self.post.pk])
        # One showing of this campaign per person per day, by the desk's dial, even
        # though the day's overall cap still has room for another page of cards.
        second = client.get('/api/feed/?cursor=' + first.data['next_cursor'])
        self.assertEqual([r for r in second.data['results'] if r.get('promoted')], [],
                         'the dial, not the day, spent this campaign')
        self.assertEqual(PromoImpression.objects.filter(viewer=self.match).count(), 1)
        self.assertLess(PromoImpression.objects.filter(
            viewer=self.match, day=timezone.now().date()).count(), 5)

    def test_interest_ranking(self):
        engaged = make_user('promoengaged', date_of_birth='1998-04-12', country='Nepal')
        for i in range(3):
            p = Post.objects.create(author=self.owner, text=f'outdoors {i}', audience='public', category='Outdoors')
            Reaction.objects.create(user=engaged, target_type='post', target_id=str(p.pk), kind='like')
            SavedPost.objects.create(user=engaged, post=p)
        low = self.promote(target_id=str(Post.objects.create(
            author=self.owner, text='travel spot', audience='public', category='Travel').pk),
            category='Travel', budget=50)
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