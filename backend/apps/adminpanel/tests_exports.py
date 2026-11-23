"""Contract 6.9: one-click CSV for members, reports, coin requests, the ledger and promotions.

A file a seat hands to an accountant is the least forgiving deliverable this console
makes, so these tests read the output the way an outsider would.

Three things make a CSV untrustworthy and each is pinned down here. A column list
that changed without anybody noticing, because a spreadsheet reconciled against the
wrong headers is worse than none — so the headers are asserted by name and the body
is parsed back and compared with the row the database holds. A file that quietly
stopped short, so the cap is tested with the cap itself pulled down to three rows and
the answer has to say so. And a file somebody took without a trace: every build writes
its own audit entry naming who, when, how many rows and which window, which is the
only reason an export of everyone's email address is a staff action and not an
accident.

The doors split the same way the screen does: the read answers "what would this
contain", the write hands the file over — as JSON to print, or as the download itself.
"""

import csv
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.auth import issue_access
from apps.accounts.models import User
from apps.common.testutils import make_user
from apps.moderation.models import AuditLog, Report
from apps.promotions.models import Promotion
from apps.wallet.models import CoinRequest, Transaction, Wallet

from . import exports
from .models import CoinReview, PromoReview, StaffAccount
from .tests_staff import RbacTestCase

INDEX_URL = '/api/admin/exports/'


def build_url(dataset, raw=False):
    return f'{INDEX_URL}{dataset}/' + ('?raw=1' if raw else '')


def rows_of(text):
    return list(csv.reader(StringIO(text)))


class ShapeTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        self.desk = self.session('client_owner')
        self.buyer = make_user('coin_buyer', password='Test-Pass-9271')

    def test_the_index_answers_every_question_a_seat_asks_before_clicking(self):
        got = self.desk.get(INDEX_URL)
        self.assertEqual(got.status_code, 200)
        self.assertEqual([item['id'] for item in got.data['files']], list(exports.NAMES))
        self.assertEqual(got.data['cap'], exports.MAX_ROWS)
        for item in got.data['files']:
            self.assertEqual(item['label'], exports.LABELS[item['id']][0])
            self.assertTrue(item['blurb'].endswith('.'), 'a column of sentences, not of fragments')
            self.assertEqual(item['columns'], exports.COLUMNS[item['id']])
        counted = {item['id']: item['rows'] for item in got.data['files']}
        self.assertEqual(counted['users'], User.objects.count())
        self.assertEqual(counted['coin_requests'], CoinRequest.objects.count())

    def test_the_file_names_its_own_columns_in_words_an_outsider_can_read(self):
        for dataset, columns in exports.COLUMNS.items():
            self.assertEqual(len(columns), len(set(columns)), f'{dataset} repeats a header')
            self.assertIn('id', columns[:2], dataset)
        self.assertIn('email', exports.COLUMNS['users'])
        self.assertIn('suspension_reason', exports.COLUMNS['users'])
        self.assertIn('decision_reason', exports.COLUMNS['coin_requests'])

    def test_the_member_file_holds_the_person_and_what_was_done_to_them(self):
        self.member.email = 'ordinary@example.com'
        self.member.save(update_fields=['email'])
        built = self.desk.post(build_url('users'), {}, format='json')
        self.assertEqual(built.status_code, 200)
        table = rows_of(built.data['csv'])
        header, body = table[0], table[1:]
        self.assertEqual(header, exports.COLUMNS['users'])
        row = next(item for item in body if item[header.index('username')] == 'ordinary')
        self.assertEqual(row[header.index('email')], 'ordinary@example.com')
        self.assertEqual(row[header.index('state')], 'active')
        self.assertEqual(built.data['rows'], len(body))

    def test_a_suspended_member_is_written_with_the_reason_they_were(self):
        self.member.suspended_until = timezone.now() + timedelta(days=3)
        self.member.suspend_reason = 'counterfeits'
        self.member.save(update_fields=['suspended_until', 'suspend_reason'])
        built = self.desk.post(build_url('users'), {}, format='json')
        table = rows_of(built.data['csv'])
        header = table[0]
        row = next(item for item in table[1:] if item[header.index('username')] == 'ordinary')
        self.assertEqual(row[header.index('state')], 'suspended')
        self.assertEqual(row[header.index('suspension_reason')], 'counterfeits')
        self.assertTrue(row[header.index('suspended_until')])

    def test_a_complaint_with_a_comma_in_it_survives_the_round_trip(self):
        Report.objects.create(reporter=self.member, target_type='post', target_id='7', reason='spam',
                              details='he said "twice", then again')
        built = self.desk.post(build_url('reports'), {}, format='json')
        table = rows_of(built.data['csv'])
        row = table[1]
        self.assertEqual(row[table[0].index('details')], 'he said "twice", then again')
        self.assertEqual(len(row), len(exports.COLUMNS['reports']))

    def test_the_staff_decision_sits_beside_the_request_it_was_made_on(self):
        request = CoinRequest.objects.create(user=self.buyer, coins=100, amount=1000, method='esewa',
                                             reference='r-9')
        CoinReview.objects.create(request=request, actor=self.admin, action='approve',
                                  reason='proof matches', coins_credited=100)
        CoinReview.objects.create(request=request, actor=self.mod, action='refund', reason='double paid')
        built = self.desk.post(build_url('coin_requests'), {}, format='json')
        table = rows_of(built.data['csv'])
        row = table[1]
        self.assertEqual(row[table[0].index('decided_by')], 'night_mod', 'the newest call is the one on the row')
        self.assertEqual(row[table[0].index('decision')], 'refund')
        self.assertEqual(row[table[0].index('decision_reason')], 'double paid')
        self.assertEqual(row[table[0].index('proof_retained')], 'no')

    def test_the_ledger_and_the_campaigns_export_their_own_tables(self):
        wallet, _ = Wallet.objects.get_or_create(user=self.buyer)
        Transaction.objects.create(wallet=wallet, kind='credit', amount=250, note='coins bought')
        promo = Promotion.objects.create(owner=self.buyer, target_type='post', target_id='3', category='local',
                                         package='starter', budget=500, status='active')
        PromoReview.objects.create(promotion=promo, actor=self.admin, action='approve', reason='paid')
        ledger = rows_of(self.desk.post(build_url('coin_ledger'), {}, format='json').data['csv'])
        self.assertEqual(ledger[1][ledger[0].index('username')], 'coin_buyer')
        self.assertEqual(ledger[1][ledger[0].index('coins')], '250.00')
        campaigns = rows_of(self.desk.post(build_url('promotions'), {}, format='json').data['csv'])
        self.assertEqual(campaigns[1][campaigns[0].index('decided_by')], 'desk_admin')
        self.assertEqual(campaigns[1][campaigns[0].index('package')], 'starter')

    def test_a_file_the_cap_cut_says_so_instead_of_looking_complete(self):
        for index in range(4):
            User.objects.create(username=f'crowd{index}')
        with mock.patch.object(exports, 'MAX_ROWS', 3):
            built = self.desk.post(build_url('users'), {}, format='json')
        self.assertEqual(built.data['rows'], 3)
        self.assertTrue(built.data['truncated'])
        self.assertIn('Cut at 50,000', built.data['detail'])
        self.assertEqual(len(rows_of(built.data['csv'])) - 1, 3, 'the header is not a row')

    def test_the_door_refuses_a_file_that_does_not_exist_and_names_the_five_that_do(self):
        refused = self.desk.post(build_url('salaries'), {}, format='json')
        self.assertEqual(refused.status_code, 404)
        for name in exports.NAMES:
            self.assertIn(name, refused.data['detail'])


class WindowTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        self.desk = self.session('client_owner')

    def test_a_bare_date_means_the_whole_day_it_is_named_after(self):
        since, until = exports.day_boundaries('2026-11-01', '2026-11-22')
        self.assertEqual((since.hour, since.minute), (0, 0))
        self.assertEqual((until.hour, until.minute, until.second), (23, 59, 59))
        self.assertIsNone(exports.day_boundaries('next month', '')[0])

    def test_the_window_is_in_the_filename_because_somebody_keeps_five_of_these(self):
        since, until = exports.day_boundaries('2026-11-01', '2026-11-22')
        self.assertEqual(exports.name_for('users', since, until),
                         'exposing-users-2026-11-01-to-2026-11-22.csv')
        self.assertEqual(exports.name_for('reports', since, None), 'exposing-reports-from-2026-11-01.csv')
        self.assertEqual(exports.name_for('coin_ledger', None, until), 'exposing-coin_ledger-to-2026-11-22.csv')
        self.assertTrue(exports.name_for('promotions').startswith(
            f"exposing-promotions-{timezone.now():%Y-%m-%d}"))

    def test_a_window_that_cuts_the_table_only_carries_the_rows_inside_it(self):
        old = make_user('from_last_year', password='Test-Pass-9271')
        User.objects.filter(pk=old.pk).update(date_joined=timezone.now() - timedelta(days=400))
        got = self.desk.post(build_url('users'), {'since': f'{timezone.now():%Y-%m-%d}'}, format='json')
        table = rows_of(got.data['csv'])
        names = [row[table[0].index('username')] for row in table[1:]]
        self.assertNotIn('from_last_year', names)
        self.assertIn('ordinary', names)

    def test_two_dates_the_wrong_way_round_are_refused_before_a_file_is_made(self):
        crossed = self.desk.post(build_url('users'),
                                 {'since': '2026-11-20', 'until': '2026-11-01'}, format='json')
        self.assertEqual(crossed.status_code, 400)
        self.assertIn('would hold nothing', crossed.data['detail'])
        self.assertFalse(AuditLog.objects.filter(action='export_csv').exists())

    def test_a_date_the_desk_cannot_read_is_answered_with_the_shape_it_wanted(self):
        got = self.desk.post(build_url('users'), {'since': 'November-ish'}, format='json')
        self.assertEqual(got.status_code, 400)
        self.assertIn('2026-11-01', got.data['detail'])

    def test_the_index_counts_the_same_window_the_file_will_cut(self):
        old = make_user('from_last_year', password='Test-Pass-9271')
        User.objects.filter(pk=old.pk).update(date_joined=timezone.now() - timedelta(days=400))
        got = self.desk.get(f'{INDEX_URL}?since={timezone.now():%Y-%m-%d}')
        users = next(item for item in got.data['files'] if item['id'] == 'users')
        self.assertEqual(users['rows'], User.objects.count() - 1)


class DownloadTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        self.desk = self.session('client_owner')

    def test_raw_hands_over_the_file_a_browser_would_save_and_nothing_else(self):
        got = self.desk.post(build_url('users', raw=True), {}, format='json')
        self.assertEqual(got.status_code, 200)
        self.assertTrue(got['Content-Type'].startswith('text/csv'))
        self.assertIn('attachment; filename="exposing-users-', got['Content-Disposition'])
        body = got.content.decode('utf-8')
        self.assertEqual(body.splitlines()[0], ','.join(exports.COLUMNS['users']))
        self.assertEqual(got['X-Export-Rows'], str(len(body.strip().splitlines()) - 1))
        self.assertEqual(got['X-Export-Truncated'], '0')

    def test_a_seat_naming_the_file_it_wants_still_reaches_the_file(self):
        """Why the console offers `text/csv, application/json` and not the file alone.

        The download is a plain file response, but DRF negotiates the Accept header
        before the view ever runs: a request that offers only `text/csv` is refused with
        a 406 of its own, and the seat then gets neither the file, nor the row count,
        nor the sentence about the dates it typed backwards. A browser clicking Download
        hit exactly that, and no test here could see it, because a test client that says
        nothing is accepted.
        """
        asked = self.desk.post(build_url('users', raw=True), {}, format='json',
                               HTTP_ACCEPT='text/csv, application/json')
        self.assertEqual(asked.status_code, 200)
        self.assertTrue(asked['Content-Type'].startswith('text/csv'))
        self.assertIn('attachment', asked['Content-Disposition'])

        alone = self.desk.post(build_url('users', raw=True), {}, format='json', HTTP_ACCEPT='text/csv')
        self.assertEqual(alone.status_code, 406)

    def test_a_json_answer_and_a_download_are_the_same_file(self):
        printed = self.desk.post(build_url('reports'), {}, format='json')
        saved = self.desk.post(build_url('reports', raw=True), {}, format='json')
        self.assertEqual(printed.data['filename'], 'exposing-reports-'
                       f'{timezone.now():%Y-%m-%d}.csv')
        self.assertIn(printed.data['filename'], saved['Content-Disposition'])
        self.assertEqual(saved['X-Export-Detail'], printed.data['detail'])

    def test_every_file_taken_is_written_down_with_who_took_it(self):
        self.desk.post(build_url('users'), {}, format='json')
        entry = AuditLog.objects.filter(action='export_csv').first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.actor.username, 'client_owner')
        self.assertEqual(entry.target, 'users')
        self.assertIn('rows', entry.detail)
        self.assertIn('every row the table holds', entry.detail)

    def test_the_index_shows_the_last_files_and_the_screen_can_print_them(self):
        self.desk.post(build_url('coin_ledger'), {}, format='json')
        got = self.desk.get(INDEX_URL)
        self.assertEqual(len(got.data['taken']), 1)
        line = got.data['taken'][0]
        self.assertEqual(line['family'], 'exports')
        self.assertEqual(line['action'], 'export_csv')

    def test_a_seat_without_the_exports_key_is_turned_away_from_every_table(self):
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        night = self.session('night_mod')
        for url in (INDEX_URL, build_url('users')):
            refused = night.get(url) if url == INDEX_URL else night.post(url, {}, format='json')
            self.assertEqual(refused.status_code, 403, url)
            self.assertEqual(refused.data['permission'], 'exports', url)
        self.assertFalse(AuditLog.objects.filter(action='export_csv').exists())

    def test_a_signed_in_member_cannot_ask_for_the_member_list(self):
        plain = APIClient()
        plain.cookies['exposing_access'] = issue_access(make_user('nosy_member', password='Test-Pass-9271'))
        turned_away = plain.get(INDEX_URL)
        self.assertEqual(turned_away.status_code, 403)
        self.assertEqual(turned_away.data['code'], 'staff_only')
