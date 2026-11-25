"""Contract 6.9: "every staff and admin action, with who did it, when, and why".

The log itself is older than this console and append-only, so what these tests hold
together is the *reading* of it, the part that decides whether a seat can actually
answer a question asked months later.

Three things would make an audit screen quietly useless, and each gets a test. A verb
that falls into a bucket nobody filters by is a verb that never happened, so the
families table is checked against the names the other modules write. A family with no
rows is indistinguishable from a family nobody thought to list, which is exactly how
"coin approvals aren't logged" gets mistaken for "there were none this month". And a
date range that ends at midnight on the day named drops the day it names, so the
boundaries are checked to land on the last second.

The door is read-only under an `audit` key: a Moderator who works the queue all day
does not get to decide what the Client is told about how the queue was worked.
"""

from datetime import timedelta
from pathlib import Path
import re

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.auth import issue_access
from apps.common.testutils import make_user
from apps.moderation.models import AuditLog, Report

from . import audit, review
from .models import StaffAccount
from .tests_staff import RbacTestCase

AUDIT_URL = '/api/admin/audit/'
GRANT_URL = '/api/admin/staff/grant/'

RECORD_CALL = re.compile(r"record\([^,()]+,\s*f?'([a-z_]+)")


def verbs_the_console_writes():
    """Every action name `record()` is handed anywhere in this app.

    Read out of the source rather than typed into a list here, so a module that
    starts writing a verb nobody filed fails this test instead of quietly putting
    rows into a bucket no seat filters by.
    """
    found = set()
    for path in sorted(Path(audit.__file__).parent.glob('*.py')):
        if path.name.startswith('tests') or path.name == '__init__.py':
            continue
        for match in RECORD_CALL.finditer(path.read_text(encoding='utf-8')):
            found.add(match.group(1))
    return found


class FamilyTests(RbacTestCase):
    def test_every_verb_the_console_writes_lands_in_a_family_somebody_can_filter_by(self):
        """A log row in a bucket with no name is a bucket nobody opens."""
        found = verbs_the_console_writes()
        found.update(review.AUDIT.values())
        found.update({'unverify_user', 'auto_hide_post'})
        unfiled = sorted(name for name in found if audit.family_of(name) == 'other')
        self.assertEqual(unfiled, [], f'{unfiled} would be counted nowhere on the audit screen')
        self.assertIn('coin_adjust', found, 'the reader found no verbs at all, fix it, not this list')

    def test_the_families_the_contract_names_are_the_ones_the_screen_lists(self):
        for family in audit.CONTRACT_FAMILIES:
            self.assertIn(family, [item['id'] for item in audit.families()])
        self.assertEqual(audit.FAMILY_LABELS['promotions'], 'Paid reach')

    def test_an_untouched_family_shows_its_zero_instead_of_vanishing(self):
        """Two hundred rows about posts and nothing about coins must read as a gap."""
        rows = {item['id']: item for item in audit.families()}
        self.assertEqual(rows['coins']['n'], 0)
        self.assertTrue(rows['coins']['contract'], 'the screen is allowed to say this one is promised')

    def test_the_line_names_the_platform_when_no_person_pressed_the_button(self):
        """An auto-hide has no actor; leaving it blank looks like a hole in the log."""
        row = AuditLog.objects.create(action='auto_hide_post', target='post:7', detail='pile reached')
        line = audit.line(row)
        self.assertEqual(line['by'], 'the platform itself')
        self.assertIsNone(line['actor'])
        self.assertEqual(line['family'], 'content')

    def test_a_verb_that_means_nothing_yet_is_filed_as_something_else(self):
        self.assertEqual(audit.family_of('unheard_of'), 'other')
        AuditLog.objects.create(actor=self.admin, action='unheard_of', target='x:1', detail='a future verb')
        rows = {item['id']: item for item in audit.families()}
        self.assertEqual(rows['other']['n'], 1)
        self.assertFalse(rows['other']['contract'], 'this one is not promised, it is a warning')


class ReadingTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        self.desk = self.session('client_owner')
        self.desk.post(GRANT_URL, {'username': 'ordinary', 'role': 'moderator'}, format='json')
        AuditLog.objects.create(action='coin_approve', target='coin:3', detail='credited 100 coins',
                                actor=self.admin)
        AuditLog.objects.create(action='warn_user', target='night_mod', detail='told them twice',
                                actor=self.mod)
        report = Report.objects.create(
            reporter=self.member, target_type='post', target_id='11', reason='harassment', details='said so',
        )
        AuditLog.objects.create(
            actor=self.mod, action='dismiss_report', target=f'report:{report.pk}', detail='not a violation',
        )

    def test_the_trail_is_newest_first_and_says_who_and_why(self):
        got = self.desk.get(AUDIT_URL)
        self.assertEqual(got.status_code, 200)
        rows = got.data['results']
        self.assertGreaterEqual(len(rows), 4)
        stamps = [row['created_at'] for row in rows]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        first = rows[0]
        self.assertEqual(set(first), {'id', 'actor', 'by', 'action', 'family', 'target', 'detail', 'created_at'})

    def test_a_family_filter_returns_only_that_kind_of_trouble(self):
        coins = self.desk.get(f'{AUDIT_URL}?family=coins').data['results']
        self.assertEqual([row['action'] for row in coins], ['coin_approve'])
        staff = self.desk.get(f'{AUDIT_URL}?family=staff').data['results']
        self.assertTrue(all(row['family'] == 'staff' for row in staff))

    def test_filtering_by_a_family_with_no_rows_returns_the_empty_it_earned(self):
        rows = self.desk.get(f'{AUDIT_URL}?family=promotions').data['results']
        self.assertEqual(rows, [])

    def test_a_seat_can_walk_back_to_one_persons_decisions(self):
        rows = self.desk.get(f'{AUDIT_URL}?actor=night_mod').data['results']
        self.assertEqual({row['action'] for row in rows}, {'warn_user', 'dismiss_report'})
        self.assertTrue(all(row['actor'] == 'night_mod' for row in rows))

    def test_the_search_box_finds_a_target_or_a_reason_not_only_a_verb(self):
        by_detail = self.desk.get(f'{AUDIT_URL}?q=credited').data['results']
        self.assertEqual([row['action'] for row in by_detail], ['coin_approve'])
        by_target = self.desk.get(f'{AUDIT_URL}?q=coin:3').data['results']
        self.assertEqual(len(by_target), 1)

    def test_a_date_with_no_clock_on_it_means_the_whole_day_it_names(self):
        """A range that drops the day it is named after reconciles with nothing."""
        today = timezone.localtime().strftime('%Y-%m-%d')
        whole = self.desk.get(AUDIT_URL).data['summary']['entries']
        upto = self.desk.get(f'{AUDIT_URL}?until={today}').data['summary']['entries']
        self.assertEqual(upto, whole)
        from_a_month_ago = self.desk.get(
            f'{AUDIT_URL}?since={(timezone.localtime() - timedelta(days=30)).strftime("%Y-%m-%d")}'
        ).data['summary']['entries']
        self.assertEqual(from_a_month_ago, whole)
        next_month = self.desk.get(
            f'{AUDIT_URL}?since={(timezone.localtime() + timedelta(days=1)).strftime("%Y-%m-%d")}'
        ).data['summary']['entries']
        self.assertEqual(next_month, 0)

    def test_the_summary_counts_the_rows_on_the_screen_and_the_whole_log_separately(self):
        got = self.desk.get(f'{AUDIT_URL}?family=coins')
        self.assertEqual(got.data['summary']['entries'], 1)
        self.assertGreater(got.data['whole']['entries'], 1)
        self.assertEqual(got.data['filters']['family'], 'coins')

    def test_the_facets_carry_the_people_and_the_verbs_a_seat_wants_to_filter_by(self):
        facets = self.desk.get(AUDIT_URL).data['facets']
        self.assertIn('client_owner', [item['actor'] for item in facets['actors']])
        counted = {item['action']: item['n'] for item in facets['actions']}
        self.assertGreaterEqual(counted['admin_login'], 1)

    def test_a_cursor_walks_the_log_instead_of_dumping_it(self):
        for index in range(45):
            AuditLog.objects.create(actor=self.admin, action='platform_settings', target=f'k{index}',
                                    detail='changed a knob')
        first = self.desk.get(AUDIT_URL)
        self.assertEqual(len(first.data['results']), 40)
        self.assertTrue(first.data['has_more'])
        self.assertIsNotNone(first.data['next_cursor'])
        second = self.desk.get(f'{AUDIT_URL}?cursor={first.data["next_cursor"]}')
        self.assertGreaterEqual(len(second.data['results']), 10)
        overlap = {row['id'] for row in first.data['results']} & {row['id'] for row in second.data['results']}
        self.assertEqual(overlap, set())

    def test_an_order_asked_for_oldest_first_is_honoured(self):
        oldest = self.desk.get(f'{AUDIT_URL}?order=oldest')
        ids = [row['id'] for row in oldest.data['results']]
        self.assertEqual(ids, sorted(ids))
        newest = self.desk.get(AUDIT_URL)
        self.assertNotEqual(ids, [row['id'] for row in newest.data['results']])

    def test_a_date_the_screen_cannot_read_is_refused_in_the_shape_it_wanted(self):
        got = self.desk.get(f'{AUDIT_URL}?since=last+tuesday')
        self.assertEqual(got.status_code, 400)
        self.assertIn('2026-11-22', got.data['detail'])

    def test_the_log_cannot_be_written_to_through_this_door(self):
        for method in ('post', 'put', 'delete'):
            refused = getattr(self.desk, method)(AUDIT_URL, {}, format='json')
            self.assertEqual(refused.status_code, 405)

    def test_a_moderator_is_turned_away_with_the_key_to_ask_for(self):
        night = self.session('night_mod')
        refused = night.get(AUDIT_URL)
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['permission'], 'audit')

    def test_a_signed_in_member_gets_nothing_from_the_staff_log(self):
        plain = APIClient()
        self.assertIn(plain.get(AUDIT_URL).status_code, (401, 403))
        signed = make_user('nosy_member', password='Test-Pass-9271')
        plain.cookies['exposing_access'] = issue_access(signed)
        turned_away = plain.get(AUDIT_URL)
        self.assertEqual(turned_away.status_code, 403)
        self.assertEqual(turned_away.data['code'], 'staff_only')


class QuerysetTests(RbacTestCase):
    def test_the_helpers_read_the_same_rows_the_door_shows(self):
        row = AuditLog.objects.create(actor=self.admin, action='restore_content', target='post:2',
                                      detail='back on')
        self.assertEqual(list(audit.queryset(action='restore_content')), [row])
        self.assertEqual(audit.family_actions('content'), ['restore_content'])
        self.assertEqual(audit.summary()['entries'], 1)
        self.assertEqual(audit.queryset(q='back on').count(), 1)

    def test_an_actor_filter_survives_be_typed_in_another_case(self):
        AuditLog.objects.create(actor=self.admin, action='coin_adjust', target='wallet:1', detail='+50')
        self.assertEqual(audit.queryset(actor='DESK_ADMIN').count(), 1)
