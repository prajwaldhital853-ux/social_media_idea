from django.core.cache import cache
from django.test import TestCase

from apps.common.testutils import auth_client, make_user, staff_client
from apps.marketplace.models import Listing


class MarketplaceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.seller = make_user('seller')
        self.buyer = make_user('buyer')
        self.cs = auth_client(self.seller)
        self.cb = auth_client(self.buyer)
        self.listing = Listing.objects.create(
            seller=self.seller, title='Trekking poles', description='Barely used', price=2500,
            category='Outdoors', condition='Used - good', location='Lalitpur',
        )

    def test_create_with_images(self):
        resp = self.cs.post('/api/marketplace/', {
            'title': 'Wool blanket', 'description': 'Handmade', 'price': 4200, 'category': 'Home',
            'location': 'Pokhara', 'images': [{'url': 'https://cdn.test/1.jpg'}, {'url': 'https://cdn.test/2.jpg'}],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(resp.data['images']), 2)
        self.assertEqual(resp.data['seller_username'], 'seller')

    def test_price_validation(self):
        resp = self.cs.post('/api/marketplace/', {'title': 'Free stuff', 'price': 0}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_filters(self):
        Listing.objects.create(seller=self.seller, title='Cheap rope', price=100, category='Outdoors', location='Pokhara')
        resp = self.cb.get('/api/marketplace/?category=Outdoors&min=1000&max=3000&q=trek')
        self.assertEqual([l['id'] for l in resp.data['results']], [self.listing.pk])
        resp = self.cb.get('/api/marketplace/?location=pokhara')
        self.assertEqual(len(resp.data['results']), 1)
        resp = self.cs.get('/api/marketplace/?mine=1')
        self.assertEqual(len(resp.data['results']), 2)
        resp = self.cb.get('/api/marketplace/?seller=seller')
        self.assertEqual(len(resp.data['results']), 2)
        resp = self.cb.get('/api/marketplace/categories/')
        self.assertIn('Outdoors', resp.data['results'])

    def test_status_transitions_owner_only(self):
        resp = self.cb.post(f'/api/marketplace/{self.listing.pk}/sold/')
        self.assertIn(resp.status_code, (403, 404))
        resp = self.cs.post(f'/api/marketplace/{self.listing.pk}/sold/')
        self.assertEqual(resp.status_code, 200)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, 'sold')
        resp = self.cs.post(f'/api/marketplace/{self.listing.pk}/relist/')
        self.assertEqual(resp.status_code, 200)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, 'active')

    def test_removed_listings_hidden(self):
        Listing.objects.filter(pk=self.listing.pk).update(status='removed')
        resp = self.cb.get('/api/marketplace/')
        self.assertEqual(resp.data['results'], [])

    def test_removed_visible_to_its_seller(self):
        # A deleted ad must still resolve for the seller who deleted it, or their
        # own link reads as a broken page instead of "not available" — but it has
        # no place in the grid, which is a page of live offers.
        Listing.objects.filter(pk=self.listing.pk).update(status='removed')
        for client in (self.cs, self.cb):
            self.assertEqual([item['id'] for item in client.get('/api/marketplace/').data['results']], [])
        self.assertEqual(self.cs.get('/api/marketplace/?mine=1').data['results'], [])
        resp = self.cs.get(f'/api/marketplace/{self.listing.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'removed')
        self.assertEqual(self.cb.get(f'/api/marketplace/{self.listing.pk}/').status_code, 404)
        # Moderation still reaches the archive, but only by asking for it.
        staff = staff_client()
        self.assertEqual(staff.get('/api/marketplace/').data['results'], [])
        archive = staff.get('/api/marketplace/?status=removed').data['results']
        self.assertIn(self.listing.pk, [item['id'] for item in archive])

    def test_patch_replaces_images(self):
        resp = self.cs.post('/api/marketplace/', {
            'title': 'Camera bag', 'price': 1500, 'category': 'Electronics', 'location': 'Kathmandu',
            'images': [{'url': 'https://cdn.test/old-1.jpg'}, {'url': 'https://cdn.test/old-2.jpg'}],
        }, format='json')
        listing = resp.data['id']
        resp = self.cs.patch(f'/api/marketplace/{listing}/', {
            'title': 'Camera bag', 'price': 1200, 'category': 'Electronics', 'location': 'Kathmandu',
            'images': [{'url': 'https://cdn.test/new.jpg'}],
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([img['url'] for img in resp.data['images']], ['https://cdn.test/new.jpg'])
        resp = self.cs.get(f'/api/marketplace/{listing}/')
        self.assertEqual(resp.data['price'], '1200.00')

    def test_only_owner_can_edit(self):
        resp = self.cb.patch(f'/api/marketplace/{self.listing.pk}/', {'title': 'Hacked'}, format='json')
        self.assertIn(resp.status_code, (403, 404))
        resp = self.cs.patch(f'/api/marketplace/{self.listing.pk}/', {'title': 'Updated poles'}, format='json')
        self.assertEqual(resp.status_code, 200)