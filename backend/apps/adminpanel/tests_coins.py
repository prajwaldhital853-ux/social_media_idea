"""Contract 6.7: coins, the money behind them, and the proof a person uploaded.

Three promises the contract makes to somebody paying real rupees, and three ways
to break them: a coin approval that can be clicked twice, a payment receipt that
leaks into the list every seat reads, and a receipt that stays on the server after
the purchase is settled. So these tests read the queue response for what it does
*not* contain, run the sweep against the clock, and assert the ledger as a list of
rows that only ever grows, there is no code path in the console that edits one.
"""

import shutil
import tempfile
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from apps.moderation.models import AuditLog
from apps.notifications.models import Notification
from apps.wallet.models import CoinRequest, Transaction, Wallet
from apps.wallet.models import apply as wallet_apply

from . import coins, settings_store
from .models import CoinReview, StaffAccount
from .tests_staff import RbacTestCase

QUEUE_URL = '/api/admin/coins/'
DESK_URL = '/api/admin/coins/desk/'
QR_URL = '/api/admin/coins/qr/'
LEDGER_URL = '/api/admin/coins/ledger/'
ADJUST_URL = '/api/admin/coins/ledger/adjust/'
PRICING_URL = '/api/coins/pricing/'

RECEIPT = b'bank-receipt-bytes-not-a-picture-needed'
DESK_BODY = {
    'coin_price': '10', 'coin_min_purchase': '100',
    'coin_bank_name': 'Nepal Bank Ltd', 'coin_bank_account': '0120-4455-8891',
    'coin_bank_holder': 'Exposing Pvt Ltd', 'coin_qr_url': '', 'coin_proof_days': '30',
}


class CoinTestCase(RbacTestCase):
    """The Client's seat, one payer, and their receipt written to a throwaway folder."""

    def setUp(self):
        super().setUp()
        self.temporary_media = tempfile.mkdtemp(prefix='coin-proof-')
        self.media = override_settings(MEDIA_ROOT=self.temporary_media)
        self.media.enable()
        self.owner = self.session('client_owner')
        self.request_for()

    def tearDown(self):
        self.media.disable()
        shutil.rmtree(self.temporary_media, ignore_errors=True)

    def request_for(self, buyer=None, count=500, rupees='5000.00', proof=True,
                    status=CoinRequest.Status.PENDING):
        buyer = buyer or self.member
        request = CoinRequest.objects.create(
            user=buyer, coins=count, amount=Decimal(rupees), method='bank',
            reference='TRX-4471', status=status,
        )
        if proof:
            name = f'proofs/{request.pk}.png'
            storages['default'].save(name, ContentFile(RECEIPT))
            request.screenshot_url = f'http://testserver/media/{name}'
            request.save(update_fields=['screenshot_url'])
        return request

    def mint(self, request):
        return self.owner.get(f'{QUEUE_URL}{request.pk}/receipt-link/').data['href']


def read(response):
    """The bytes of a FileResponse, streaming or not."""
    if getattr(response, 'streaming', False):
        return b''.join(response.streaming_content)
    return response.content


class QueueTests(CoinTestCase):
    def test_the_queue_says_who_paid_what_and_keeps_their_receipt_to_itself(self):
        out = self.owner.get(QUEUE_URL)
        self.assertEqual(out.status_code, 200)
        row = out.data['results'][0]
        self.assertEqual(row['card']['username'], 'ordinary')
        self.assertEqual(row['coins'], 500)
        self.assertEqual(str(row['amount']), '5000.00')
        self.assertEqual(row['reference'], 'TRX-4471')
        self.assertTrue(row['has_proof'], 'the console is told a proof exists')
        self.assertNotIn('media/proofs', str(out.data), 'the picture itself is not in the list')
        self.assertNotIn('screenshot', str(out.data))

    def test_the_money_held_up_is_counted_from_the_same_table_the_queue_reads(self):
        self.request_for(count=100, rupees='1000.00')
        out = self.owner.get(QUEUE_URL)
        self.assertEqual(out.data['counts']['pending'], 2)
        self.assertEqual(out.data['held']['coins'], 600)
        self.assertEqual(str(out.data['held']['rupees']), '6000.00')

    def test_a_search_finds_the_payer_and_the_bank_reference(self):
        self.assertEqual(len(self.owner.get(QUEUE_URL, {'q': 'ordinary'}).data['results']), 1)
        self.assertEqual(len(self.owner.get(QUEUE_URL, {'q': 'TRX-44'}).data['results']), 1)
        self.assertEqual(self.owner.get(QUEUE_URL, {'q': 'nobody-here'}).data['results'], [])

    def test_the_open_door_quotes_the_price_the_bank_and_the_floor_and_nothing_else(self):
        out = self.client.get(PRICING_URL)
        self.assertEqual(out.status_code, 200)
        self.assertEqual(set(out.data), {'coin_price', 'min_purchase', 'bank', 'proof_days'})
        self.assertEqual(str(out.data['coin_price']), '10.00')
        self.assertEqual(out.data['bank']['account'], '0120-4455-8891')
        self.assertEqual(out.data['min_purchase'], 100)
        self.assertNotIn('ordinary', str(out.data))
        self.assertNotIn('TRX-4471', str(out.data))


class DecisionTests(CoinTestCase):
    def test_approving_credits_the_wallet_once_and_leaves_an_append_only_ledger_row(self):
        request = self.request_for()
        out = self.owner.post(f'{QUEUE_URL}{request.pk}/approve/', {}, format='json')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['coins_credited'], 500)

        wallet = Wallet.objects.get(user=self.member)
        self.assertEqual(wallet.balance, Decimal(500))
        self.assertEqual(str(out.data['balance']), '500.00')
        entry = wallet.transactions.order_by('-created_at', '-id').first()
        self.assertEqual(entry.kind, Transaction.Kind.CREDIT)
        self.assertEqual(entry.amount, Decimal(500))
        self.assertIn('ledger row is #', out.data['detail'])
        request.refresh_from_db()
        self.assertEqual(request.status, CoinRequest.Status.APPROVED)
        self.assertEqual(CoinReview.objects.filter(request=request, coins_credited=500).count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        receipt = mail.outbox[0]
        self.assertEqual(receipt.to, [self.member.email])
        self.assertIn('coin purchase is confirmed', receipt.subject.lower())
        self.assertIn('500 coins', receipt.body)
        self.assertIn('#E40104', receipt.alternatives[0].content)

    def test_the_same_receipt_approved_twice_moves_no_coins_at_all(self):
        request = self.request_for()
        self.owner.post(f'{QUEUE_URL}{request.pk}/approve/', {}, format='json')
        twice = self.owner.post(f'{QUEUE_URL}{request.pk}/approve/', {}, format='json')
        self.assertEqual(twice.status_code, 409)
        self.assertIn('already approved', twice.data['detail'])

        wallet = Wallet.objects.get(user=self.member)
        self.assertEqual(wallet.transactions.count(), 1)
        self.assertEqual(wallet.balance, Decimal(500))
        self.assertEqual(len(mail.outbox), 1, 'a refused duplicate sends no second receipt')

    def test_a_rejection_needs_the_sentence_the_payer_is_sent_and_credits_nothing(self):
        request = self.request_for()
        blank = self.owner.post(f'{QUEUE_URL}{request.pk}/reject/', {'reason': '  '}, format='json')
        self.assertEqual(blank.status_code, 400)
        self.assertIn('Say why', blank.data['detail'])

        said = self.owner.post(f'{QUEUE_URL}{request.pk}/reject/',
                               {'reason': 'the reference does not match the amount'}, format='json')
        self.assertEqual(said.status_code, 200)
        request.refresh_from_db()
        self.assertEqual(request.status, CoinRequest.Status.REJECTED)
        self.assertEqual(Wallet.objects.get(user=self.member).balance, Decimal(0))
        note = Notification.objects.filter(recipient=self.member, kind='coins').last()
        self.assertIn('reference does not match', note.text)
        self.assertEqual(len(mail.outbox), 1, 'a refusal is answered in the mailbox as well as the bell')
        letter = mail.outbox[0]
        self.assertEqual(letter.to, [self.member.email])
        self.assertIn('refused', letter.subject.lower())
        self.assertNotIn('confirmed', letter.subject.lower(), 'a refusal never reads as a receipt')
        self.assertIn('the reference does not match the amount', letter.body)
        self.assertIn('#E40104', letter.alternatives[0].content)

    def test_asking_for_more_proof_keeps_the_request_open_and_can_be_asked_twice(self):
        request = self.request_for()
        first = self.owner.post(f'{QUEUE_URL}{request.pk}/proof/',
                                 {'reason': 'the receipt is cut off at the right edge'}, format='json')
        self.assertEqual(first.status_code, 200)
        request.refresh_from_db()
        self.assertEqual(request.status, CoinRequest.Status.PENDING, 'a question is not a decision')
        self.assertTrue(request.screenshot_url, 'the receipt stays, because the case is still open')

        second = self.owner.post(f'{QUEUE_URL}{request.pk}/proof/',
                                  {'reason': 'and the date on it is unreadable'}, format='json')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(second.data['asks']), 2, 'the first ask is not overwritten')
        self.assertEqual(second.data['asks'][0]['reason'], 'the receipt is cut off at the right edge')
        self.assertEqual(CoinReview.objects.filter(request=request).count(), 2)

    def test_an_unknown_verb_is_refused_rather_than_treated_as_an_approval(self):
        request = self.request_for()
        out = self.owner.post(f'{QUEUE_URL}{request.pk}/refund/', {}, format='json')
        self.assertEqual(out.status_code, 400)
        request.refresh_from_db()
        self.assertEqual(request.status, CoinRequest.Status.PENDING)

    def test_a_settled_request_reopened_from_its_own_url_still_names_who_settled_it(self):
        """The click that leaves the queue is not the last time this row is read.

        A seat asked two weeks later "who credited these coins" opens the request by
        its id, and a row that answers with no decision column reads exactly like a
        purchase nobody ever looked at.
        """
        request = self.request_for()
        self.owner.post(f'{QUEUE_URL}{request.pk}/approve/', {}, format='json')

        settled = self.owner.get(f'{QUEUE_URL}{request.pk}/').data
        self.assertEqual(settled['request']['status'], CoinRequest.Status.APPROVED)
        self.assertEqual(settled['request']['review']['by'], 'client_owner')
        self.assertEqual(settled['request']['review']['coins_credited'], 500)
        self.assertEqual([ask['action'] for ask in settled['asks']], ['approve'])

    def test_every_decision_names_the_seat_who_made_it_in_the_audit_log(self):
        request = self.request_for()
        self.owner.post(f'{QUEUE_URL}{request.pk}/approve/', {}, format='json')
        row = AuditLog.objects.get(target=f'coin_request:{request.pk}')
        self.assertEqual(row.actor, get_user_model().objects.get(username='client_owner'))
        self.assertEqual(row.action, 'coins_approve')
        self.assertIn('500 coins', row.detail)


class ProofLinkTests(CoinTestCase):
    def test_a_proof_opens_only_through_a_link_the_console_mints_for_that_seat(self):
        request = self.request_for()
        minted = self.owner.get(f'{QUEUE_URL}{request.pk}/receipt-link/')
        self.assertEqual(minted.status_code, 200)
        self.assertEqual(minted.data['expires_in'], coins.PROOF_TTL)
        self.assertIn(f'/receipt/?t=', minted.data['href'])

        opened = self.owner.get(minted.data['href'])
        self.assertEqual(opened.status_code, 200)
        self.assertEqual(read(opened), RECEIPT)

    def test_a_link_made_for_one_purchase_does_not_open_another(self):
        mine = self.request_for()
        theirs = self.request_for()
        token = self.mint(mine).split('t=')[1]
        swapped = self.owner.get(f'{QUEUE_URL}{theirs.pk}/receipt/?t={token}')
        self.assertEqual(swapped.status_code, 403)

    def test_a_link_that_has_been_tampered_with_is_refused(self):
        request = self.request_for()
        href = self.mint(request)
        self.assertEqual(self.owner.get(href[:-6] + 'AAAAAA').status_code, 410)

    def test_a_link_needs_the_token_rather_than_just_a_seat_with_the_key(self):
        request = self.request_for()
        out = self.owner.get(f'{QUEUE_URL}{request.pk}/receipt/')
        self.assertEqual(out.status_code, 400)
        self.assertIn('a link from the queue', out.data['detail'])

    def test_a_link_dies_once_its_two_minutes_are_up(self):
        request = self.request_for()
        token = self.mint(request).split('t=')[1]
        response, error = coins.proof_file(request, self.owner_user().pk, token, ttl=-1)
        self.assertIsNone(response)
        self.assertEqual(error[1], 410)

    def test_a_request_with_no_receipt_says_so_instead_of_serving_a_blank_image(self):
        request = self.request_for(proof=False)
        self.assertEqual(self.owner.get(f'{QUEUE_URL}{request.pk}/receipt-link/').status_code, 404)

    def owner_user(self):
        return get_user_model().objects.get(username='client_owner')


class RetentionTests(CoinTestCase):
    def settled(self, status, days_ago):
        """A decided request whose receipt is `days_ago` old."""
        request = self.request_for(status=status)
        request.reviewed_at = timezone.now() - timedelta(days=days_ago)
        request.save(update_fields=['reviewed_at'])
        return request

    def test_a_receipt_past_the_window_is_deleted_and_the_row_stops_pointing_at_it(self):
        request = self.settled(CoinRequest.Status.APPROVED, 31)
        name = request.screenshot_url.split('/media/')[1]
        self.assertTrue(storages['default'].exists(name))

        out = self.owner.get(QUEUE_URL)
        self.assertEqual(out.data['proofs_deleted'], 1)
        self.assertEqual(out.data['retention_days'], 30)
        request.refresh_from_db()
        self.assertEqual(request.screenshot_url, '')
        self.assertFalse(storages['default'].exists(name), 'the file is gone, not just unlinked')

    def test_a_receipt_inside_the_window_is_left_where_it_is(self):
        request = self.settled(CoinRequest.Status.APPROVED, 3)
        out = self.owner.get(QUEUE_URL)
        self.assertEqual(out.data['proofs_deleted'], 0)
        request.refresh_from_db()
        self.assertTrue(request.screenshot_url)

    def test_a_purchase_nobody_ever_decided_does_not_get_to_keep_the_receipt_forever(self):
        request = self.request_for()
        request.created_at = timezone.now() - timedelta(days=40)
        request.save(update_fields=['created_at'])
        self.assertEqual(self.owner.get(QUEUE_URL).data['proofs_deleted'], 1)

    def test_the_window_is_a_number_the_admin_turns_and_the_sweep_follows_it(self):
        request = self.settled(CoinRequest.Status.REJECTED, 6)
        self.assertEqual(self.owner.get(QUEUE_URL).data['proofs_deleted'], 0)

        saved = self.post_desk(coin_proof_days='5')
        self.assertEqual(saved.status_code, 200)
        loaded = self.owner.get(QUEUE_URL)
        self.assertEqual(loaded.data['retention_days'], 5)
        self.assertEqual(loaded.data['proofs_deleted'], 1)
        request.refresh_from_db()
        self.assertEqual(request.screenshot_url, '')

    def test_a_window_of_zero_days_means_the_picture_goes_the_day_the_purchase_settles(self):
        """Zero is the Admin's word for "delete it as soon as this is settled".

        A `get(...) or 30` reads that deliberate zero as an empty box and quietly
        keeps a stranger's bank slip for another month, this is the one setting in
        the section that deletes other people's private documents, so it is tested.
        """
        request = self.request_for(status=CoinRequest.Status.APPROVED)
        request.reviewed_at = timezone.now() - timedelta(hours=4)
        request.save(update_fields=['reviewed_at'])

        self.assertEqual(self.post_desk(coin_proof_days='0').status_code, 200)
        loaded = self.owner.get(QUEUE_URL)
        self.assertEqual(loaded.data['retention_days'], 0)
        # Zero means zero: the settled purchase loses its slip and so does the one
        # still waiting, because "keep nothing after the window" cannot mean
        # "except the rows that are not decided yet".
        self.assertEqual(loaded.data['proofs_deleted'], 2)
        request.refresh_from_db()
        self.assertEqual(request.screenshot_url, '')

    def post_desk(self, **over):
        body = dict(DESK_BODY)
        body.update(over)
        return self.owner.post(DESK_URL, body, format='json')


class LedgerTests(CoinTestCase):
    def test_the_ledger_reads_the_wallets_own_history_and_the_page_names_the_owner(self):
        wallet = Wallet.objects.get_or_create(user=self.member)[0]
        wallet_apply(wallet.pk, Transaction.Kind.CREDIT, Decimal('250'), 'seeding the test')
        out = self.owner.get(LEDGER_URL)
        self.assertEqual(out.status_code, 200)
        row = out.data['results'][0]
        self.assertEqual(row['username'], 'ordinary')
        self.assertEqual(str(row['amount']), '250.00')
        self.assertEqual(row['kind'], Transaction.Kind.CREDIT)
        self.assertEqual(str(out.data['totals']['credited']), '250.00')

    def test_a_ledger_row_shows_the_wallets_present_number_not_an_invented_history(self):
        wallet = Wallet.objects.get_or_create(user=self.member)[0]
        wallet_apply(wallet.pk, Transaction.Kind.CREDIT, Decimal('300'), 'first purchase')
        wallet_apply(wallet.pk, Transaction.Kind.DEBIT, Decimal('120'), 'bought a boost')

        newest = self.owner.get(LEDGER_URL).data['results'][0]
        self.assertEqual(newest['kind'], Transaction.Kind.DEBIT)
        self.assertEqual(newest['amount'], '120.00')
        self.assertEqual(newest['balance'], '180.00', 'the wallet’s own number, not a column of arithmetic')
        self.assertNotIn('balance_after', newest)

    def test_a_hand_written_adjustment_is_refused_until_the_reason_is_written(self):
        blank = self.owner.post(ADJUST_URL, {'username': 'ordinary', 'direction': 'credit',
                                             'amount': '50', 'reason': ''}, format='json')
        self.assertEqual(blank.status_code, 400)
        self.assertIn('reason', blank.data['detail'])
        self.assertEqual(Transaction.objects.count(), 0)

    def test_an_adjustment_with_a_reason_adds_a_row_and_touches_no_old_one(self):
        wallet = Wallet.objects.get_or_create(user=self.member)[0]
        wallet_apply(wallet.pk, Transaction.Kind.CREDIT, Decimal('100'), 'a purchase')
        wallet_apply(wallet.pk, Transaction.Kind.DEBIT, Decimal('10'), 'bought a promotion')
        first_id = wallet.transactions.order_by('id').first().pk

        moved = self.owner.post(ADJUST_URL, {'username': 'ordinary', 'direction': 'credit',
                                             'amount': '75',
                                             'reason': 'the bank confirmed a second payment'}, format='json')
        self.assertEqual(moved.status_code, 200)
        self.assertEqual(Transaction.objects.count(), 3)
        self.assertEqual(str(Wallet.objects.get(user=self.member).balance), '165.00')
        self.assertIn('Credited', moved.data['detail'])

        old = Transaction.objects.get(pk=first_id)
        self.assertEqual(old.note, 'a purchase')
        self.assertEqual(old.amount, Decimal('100'))
        self.assertEqual(Transaction.objects.get(pk=first_id).pk, first_id)

    def test_a_debit_that_would_go_below_zero_is_refused_in_the_wallets_own_words(self):
        self.owner.post(ADJUST_URL, {'username': 'ordinary', 'direction': 'credit',
                                     'amount': '20', 'reason': 'goodwill'}, format='json')
        over = self.owner.post(ADJUST_URL, {'username': 'ordinary', 'direction': 'debit',
                                            'amount': '500', 'reason': 'taking it back'}, format='json')
        self.assertEqual(over.status_code, 400)
        self.assertIn('Insufficient balance', over.data['detail'])
        self.assertEqual(str(Wallet.objects.get(user=self.member).balance), '20.00')
        self.assertEqual(Transaction.objects.count(), 1)

    def test_an_adjustment_of_zero_or_of_nobody_is_refused(self):
        zero = self.owner.post(ADJUST_URL, {'username': 'ordinary', 'direction': 'credit',
                                            'amount': '0', 'reason': 'a rounding fix'}, format='json')
        self.assertEqual(zero.status_code, 400)
        ghost = self.owner.post(ADJUST_URL, {'username': 'phantom', 'direction': 'credit',
                                             'amount': '5', 'reason': 'wrong account'}, format='json')
        self.assertEqual(ghost.status_code, 404)


class PricingDeskTests(CoinTestCase):
    def test_the_desk_shows_every_payment_knob_with_its_default_behind_it(self):
        page = self.owner.get(DESK_URL)
        self.assertEqual(page.status_code, 200)
        keys = [line['key'] for line in page.data['lines']]
        for knob in ('coin_price', 'coin_min_purchase', 'coin_bank_account', 'coin_qr_url', 'coin_proof_days'):
            self.assertIn(knob, keys)
        price = next(line for line in page.data['lines'] if line['key'] == 'coin_price')
        self.assertEqual(float(price['default']), 10.0)
        self.assertFalse(price['set'], 'nobody has turned this knob yet')

    def test_a_price_and_a_floor_written_here_are_what_the_open_door_quotes_next(self):
        saved = self.post_desk(coin_price='12.50', coin_min_purchase='250')
        self.assertEqual(saved.status_code, 200)
        quoted = self.client.get(PRICING_URL).data
        self.assertEqual(str(quoted['coin_price']), '12.50')
        self.assertEqual(quoted['min_purchase'], 250)
        self.assertIn('deploy', saved.data['detail'])

    def test_a_coin_cannot_be_priced_at_zero_because_that_is_not_a_price(self):
        zero = self.post_desk(coin_price='0')
        self.assertEqual(zero.status_code, 400)
        self.assertIn('above zero', zero.data['detail'])
        negative = self.post_desk(coin_price='-4')
        self.assertEqual(negative.status_code, 400)
        self.assertIn('negative', negative.data['detail'])
        self.assertEqual(settings_store.get('coin_price'), Decimal('10'))

    def test_a_number_that_is_not_a_number_is_refused_rather_than_falling_back_silently(self):
        out = self.post_desk(coin_min_purchase='abc')
        self.assertEqual(out.status_code, 400)
        self.assertIn('number', out.data['detail'])

    def test_saving_exactly_what_is_already_written_is_refused_not_logged_twice(self):
        self.post_desk(coin_bank_account='0120-4455-8891')
        again = self.post_desk(coin_bank_account='0120-4455-8891')
        self.assertEqual(again.status_code, 400)
        self.assertIn('Nothing to save', again.data['detail'])

    def test_a_payment_image_is_stored_outside_the_upload_folder_and_the_swap_is_audited(self):
        out = self.owner.post(QR_URL, {'file': SimpleUploadedFile('bank-qr.png', RECEIPT, 'image/png')})
        self.assertEqual(out.status_code, 200, out.data)
        quoted = self.client.get(PRICING_URL).data
        self.assertIn('coin-qr/', quoted['bank']['qr'])
        self.assertNotIn('uploads/', quoted['bank']['qr'])
        audit = AuditLog.objects.filter(action='coin_qr', actor__username='client_owner').order_by('pk')
        self.assertEqual(audit.count(), 1)
        self.assertIn('first payment QR', audit.first().detail)

        second = self.owner.post(QR_URL, {'file': SimpleUploadedFile('bank-qr.png', RECEIPT, 'image/png')})
        self.assertEqual(second.status_code, 200)
        self.assertIn('Replaced',
                      AuditLog.objects.filter(action='coin_qr').order_by('pk').last().detail)

    def test_a_payment_image_that_is_not_a_picture_is_refused(self):
        out = self.owner.post(QR_URL,
                              {'file': SimpleUploadedFile('invoice.pdf', b'%PDF-1.4', 'application/pdf')})
        self.assertEqual(out.status_code, 400)
        self.assertIn('PNG, JPEG or WebP', out.data['detail'])

    def post_desk(self, **over):
        body = dict(DESK_BODY)
        body.update(over)
        return self.owner.post(DESK_URL, body, format='json')


class SeatTests(CoinTestCase):
    def grant(self, *keys):
        seat = StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        seat.granted_keys = list(keys)
        seat.save(update_fields=['granted_keys'])
        return self.session('night_mod')

    def test_a_moderator_without_the_money_keys_is_refused_every_door_naming_the_first_one(self):
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        mod = self.session('night_mod')
        for url in (QUEUE_URL, LEDGER_URL, DESK_URL):
            self.assertEqual(mod.get(url).status_code, 403, url)
        self.assertEqual(mod.get(QUEUE_URL).data['permission'], 'coins_view')

    def test_a_seat_that_may_read_but_must_not_decide_can_open_a_proof_and_cannot_credit_one(self):
        mod = self.grant('coins_view')
        request = self.request_for()

        page = mod.get(QUEUE_URL)
        self.assertEqual(page.status_code, 200)
        self.assertFalse(page.data['can_review'], 'the screen is told, not left to guess')
        self.assertEqual(mod.get(f'{QUEUE_URL}{request.pk}/receipt-link/').status_code, 200)

        refused = mod.post(f'{QUEUE_URL}{request.pk}/approve/', {}, format='json')
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['permission'], 'coins_review')
        request.refresh_from_db()
        self.assertEqual(request.status, CoinRequest.Status.PENDING)

    def test_a_proof_link_minted_by_another_seat_does_not_open_for_this_one(self):
        mod = self.grant('coins_view')
        request = self.request_for()
        href = self.mint(request)
        stolen = mod.get(href)
        self.assertEqual(stolen.status_code, 403)

    def test_the_cashier_key_does_not_open_the_pricing_desk(self):
        mod = self.grant('coins_view', 'coins_review')
        out = mod.get(DESK_URL)
        self.assertEqual(out.status_code, 403)
        self.assertEqual(out.data['permission'], 'coin_settings')
