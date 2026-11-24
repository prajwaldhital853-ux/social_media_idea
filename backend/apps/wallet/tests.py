from decimal import Decimal
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase

from apps.common.testutils import auth_client, make_user, run_threads, staff_client
from apps.wallet.models import CoinRequest, Transaction, Wallet, apply


class WalletTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('walletuser')
        self.cu = auth_client(self.user)
        self.wallet = self.user.wallet

    def test_credit_debit_and_ledger(self):
        apply(self.wallet.pk, 'credit', 1000, 'welcome')
        apply(self.wallet.pk, 'debit', 250, 'promotion')
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('750'))
        resp = self.cu.get('/api/wallet/')
        self.assertEqual(resp.data['balance'], 750)
        self.assertEqual(len(resp.data['results']), 2)
        self.assertEqual(resp.data['results'][0]['kind'], 'debit')

    def test_overdraft_rejected(self):
        with self.assertRaises(ValueError):
            apply(self.wallet.pk, 'debit', 1, 'too much')
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('0'))
        self.assertEqual(Transaction.objects.count(), 0)

    def test_non_positive_amount_rejected(self):
        with self.assertRaises(ValueError):
            apply(self.wallet.pk, 'credit', 0)

    def test_ledger_is_append_only(self):
        from django.db import DatabaseError, transaction
        row = apply(self.wallet.pk, 'credit', 100)
        row.note = 'tampered'
        with self.assertRaises(ValueError):
            row.save()
        with self.assertRaises(ValueError):
            row.delete()
        with self.assertRaises(DatabaseError):
            with transaction.atomic():
                Transaction.objects.filter(pk=row.pk).delete()
        with self.assertRaises(DatabaseError):
            with transaction.atomic():
                Transaction.objects.filter(pk=row.pk).update(note='tampered')
        self.assertTrue(Transaction.objects.filter(pk=row.pk).exists())

    def test_coin_request_review_staff_only(self):
        resp = self.cu.post('/api/wallet/requests/', {'coins': 500, 'amount': 500, 'method': 'esewa', 'reference': 'REF1'}, format='json')
        self.assertEqual(resp.status_code, 201)
        req_id = resp.data['id']
        resp = self.cu.post(f'/api/wallet/requests/{req_id}/approve/')
        self.assertIn(resp.status_code, (403, 404))
        staff = staff_client()
        listing = staff.get('/api/wallet/requests/list/')
        self.assertTrue(any(r['id'] == req_id for r in listing.data['results']))
        resp = staff.post(f'/api/wallet/requests/{req_id}/approve/')
        self.assertEqual(resp.status_code, 200)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('500'))
        self.assertTrue(self.user.notifications.filter(kind='coins').exists() or self.user.notifications.exists())
        resp = staff.post(f'/api/wallet/requests/{req_id}/approve/')
        self.assertEqual(resp.status_code, 404)

    def test_legacy_coin_approval_emails_one_receipt(self):
        req = CoinRequest.objects.create(user=self.user, coins=250, amount=2500, reference='LEGACY-1')
        staff = staff_client()
        with mock.patch('apps.common.emails.send_off_request', side_effect=lambda task, *args: task(*args)):
            first = staff.post(f'/api/wallet/requests/{req.pk}/approve/')
            twice = staff.post(f'/api/wallet/requests/{req.pk}/approve/')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(twice.status_code, 404)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        self.assertIn('250 coins', mail.outbox[0].body)
        self.assertIn('LEGACY-1', mail.outbox[0].body)

    def test_coin_request_reject(self):
        req = CoinRequest.objects.create(user=self.user, coins=100, amount=100)
        staff = staff_client()
        resp = staff.post(f'/api/wallet/requests/{req.pk}/reject/')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'rejected')
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('0'))

    def test_users_see_only_own_requests(self):
        CoinRequest.objects.create(user=self.user, coins=100, amount=100)
        other = auth_client(make_user('walletother'))
        resp = other.get('/api/wallet/requests/list/')
        self.assertEqual(resp.data['results'], [])


class WalletConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('concwallet')
        self.wallet = self.user.wallet

    def test_simultaneous_credits_no_lost_updates(self):
        def credit(i):
            return apply(self.wallet.pk, 'credit', 10, f'credit {i}').pk

        ids = run_threads(credit, range(25), workers=10)
        self.assertEqual(len(set(ids)), 25)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('250'))
        self.assertEqual(Transaction.objects.filter(wallet=self.wallet).count(), 25)

    def test_simultaneous_debits_never_overdraw(self):
        apply(self.wallet.pk, 'credit', 100, 'seed balance')

        def debit(i):
            try:
                apply(self.wallet.pk, 'debit', 10, f'debit {i}')
                return True
            except ValueError:
                return False

        results = run_threads(debit, range(20), workers=10)
        self.assertEqual(results.count(True), 10)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, Decimal('0'))