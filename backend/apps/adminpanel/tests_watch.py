"""Contract 6.9, second half: the alerts that fire themselves, and what became of them.

The desk is the part of the console that has to be believed rather than trusted, so
the tests are about three things a Client would check out loud. That every condition
the contract names is actually measured from a table the platform writes, a
threshold with no check behind it is a knob that does nothing. That a trouble lasting
an hour stays *one* alert with `occurrences` climbing, and disappears the moment it
stops being true, because a feed full of duplicates and stale rows is a feed people
stop reading. And that the four conditions nothing here can see, uptime, backups,
app errors, the transcoder, say so plainly, with the command that would start
reporting, instead of showing a green row that means nobody is watching.

The `adminpulse` command is tested with it because the wire and the reading of the
wire are one promise: a stamp that the desk could not tell apart from silence would
be a worse lie than no stamp at all.
"""

from datetime import timedelta

from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from io import StringIO
from rest_framework.test import APIClient

from apps.accounts.auth import issue_access
from apps.accounts.models import User
from apps.common.testutils import make_user
from apps.moderation.models import AuditLog, Report
from apps.posts.models import Post
from apps.wallet.models import CoinRequest

from . import alerts, settings_store
from .models import AdminAlert, AdminPulse, AdminSetting, StaffAccount
from .tests_staff import RbacTestCase
from .views_alerts import KIND_LABELS

DESK_URL = '/api/admin/alerts/'
SCAN_URL = '/api/admin/alerts/scan/'
THRESHOLDS_URL = '/api/admin/alerts/thresholds/'

MEDIA_DISK = {'state': 'ok', 'bytes': 0, 'files': 0, 'by_kind': {}, 'detail': ''}


class AlertTestCase(RbacTestCase):
    """Two seats, a signed-in owner and one post everything gets reported on."""

    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        self.desk = self.session('client_owner')
        self.author = make_user('flagged_author', password='Test-Pass-9271')
        self.post = Post.objects.create(author=self.author, text='a reel about the new studio')

    def reporters(self, count, target=None, kind='post', reason='spam', status=Report.Status.OPEN,
                  age_hours=2):
        """`count` distinct members complaining about one thing, `age_hours` ago.

        The stamp moves because the two checks that read reports look at different
        windows: a pile is whatever is open, a spike is whatever arrived this hour.
        """
        target = target if target is not None else self.post
        self.seen = getattr(self, 'seen', 0) + 1
        for index in range(count):
            who = User.objects.create(username=f'alarm{self.seen}_{index}_{kind}{target.pk}')
            Report.objects.create(reporter=who, target_type=kind, target_id=str(target.pk),
                                  reason=reason, details='said so', status=status)
        Report.objects.filter(reporter__username__startswith=f'alarm{self.seen}_').update(
            created_at=timezone.now() - timedelta(hours=age_hours),
        )
        return target

    def dial(self, key, value):
        AdminSetting.objects.update_or_create(key=key, defaults={'value': str(value)})


class ScanTests(AlertTestCase):
    def test_every_condition_the_contract_names_is_measured_from_something(self):
        """A threshold with no check behind it is a knob that does nothing."""
        for key in ('report_pile', 'report_ageing', 'coin_queue_ageing', 'autohide_wave', 'staff_lockouts',
                    'storage_high', 'report_spike', 'signup_wave', 'login_attack', 'coin_rush',
                    'disk_high', 'db_large', 'health_down'):
            self.assertIn(key, KIND_LABELS, f'{key} is named on the desk but no check raises it')
        self.assertEqual(set(alerts.PULSES), {'web', 'backup', 'errors', 'jobs'})


    def test_the_thresholds_the_checks_read_are_all_on_the_desk(self):
        listed = {line['key'] for line in alerts.threshold_lines()}
        self.assertEqual(listed, set(alerts.THRESHOLDS))
        self.assertEqual(len(alerts.THRESHOLDS), 18)

    def test_a_pile_of_reports_raises_one_alert_and_the_next_scan_does_not_make_it_two(self):
        self.reporters(4)
        raised = alerts.scan(media=MEDIA_DISK)
        rows = AdminAlert.objects.filter(kind='report_pile')
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.first().occurrences, 1)
        self.assertIn('report_pile', [item.kind for item in raised])

        alerts.scan(media=MEDIA_DISK)
        self.assertEqual(AdminAlert.objects.filter(kind='report_pile').count(), 1)
        self.assertEqual(AdminAlert.objects.get(kind='report_pile').occurrences, 2)

    def test_an_alert_links_to_the_screen_that_clears_it(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='report_pile')
        self.assertEqual(row.href, '/reports?target=post&status=open')
        self.assertIn(str(self.post.pk), row.detail)
        self.assertEqual(row.context['post_id'], str(self.post.pk))

    def test_a_condition_that_stops_being_true_leaves_the_feed(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        self.assertEqual(AdminAlert.objects.get(kind='report_pile').status, AdminAlert.Status.OPEN)
        Report.objects.update(status=Report.Status.DISMISSED, resolved_at=timezone.now())
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='report_pile')
        self.assertEqual(row.status, AdminAlert.Status.RESOLVED)
        self.assertIsNotNone(row.resolved_at)

    def test_reports_nobody_has_answered_are_their_own_trouble(self):
        """One reporter is not a pile, but three weeks of silence is still a failure."""
        self.reporters(1)
        Report.objects.update(created_at=timezone.now() - timedelta(hours=30))
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='report_ageing')
        self.assertEqual(row.context['count'], 1)
        self.assertIn('over 24 hours', row.detail)

    def test_a_day_of_automatic_hides_is_read_as_a_threshold_problem_too(self):
        self.dial('alert_autohide_day', 3)
        for index in range(3):
            AuditLog.objects.create(action='auto_hide_post', target=f'post:{index}', detail='pile reached')
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='autohide_wave')
        self.assertEqual(row.severity, AdminAlert.Severity.CRITICAL)
        self.assertIn('pile threshold set too low', row.detail)

    def test_payment_proofs_held_behind_the_review_are_counted_in_coins(self):
        request = CoinRequest.objects.create(user=self.author, coins=250, amount=2500, method='esewa',
                                             reference='r-1')
        CoinRequest.objects.filter(pk=request.pk).update(created_at=timezone.now() - timedelta(hours=30))
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='coin_queue_ageing')
        self.assertEqual(row.context['coins'], 250)

    def test_two_staff_seats_locked_out_look_like_somebody_trying_to_get_in(self):
        later = timezone.now() + timedelta(minutes=9)
        for user in (self.admin, self.mod):
            StaffAccount.objects.filter(user=user).update(totp_locked_until=later, login_locked_until=later)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='staff_lockouts')
        self.assertEqual(row.context['seats'], 2)
        self.assertEqual(row.href, '/access?state=locked')

    def test_a_fleet_of_signups_names_the_accounts_it_created(self):
        self.dial('alert_signup_wave', 8)
        for index in range(6):
            User.objects.create(username=f'bot{index}', email_verified=False)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='signup_wave')
        self.assertGreaterEqual(row.context['joined'], 6)
        self.assertLessEqual(row.context['unverified'], row.context['joined'])
        self.assertEqual(len(row.context['usernames']), 5, 'the screen names five and says how many more')

    def test_many_accounts_locked_at_one_time_is_read_as_an_attack(self):
        later = timezone.now() + timedelta(minutes=15)
        for index in range(5):
            User.objects.create(username=f'victim{index}', locked_until=later)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='login_attack')
        self.assertEqual(row.severity, AdminAlert.Severity.CRITICAL)
        self.assertEqual(row.context['accounts'], 5)

    def test_a_report_run_in_one_hour_is_named_by_the_reasons_it_used(self):
        self.dial('alert_report_spike', 3)
        self.reporters(4, age_hours=0)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='report_spike')
        self.assertEqual(row.context['reasons'][0]['reason'], 'spam')

    def test_a_coin_hour_is_a_problem_in_both_directions(self):
        """Many small requests, or few enormous ones, the same alert, a different sentence."""
        self.dial('alert_coin_coins_hour', 100)
        for coins in (60, 70):
            request = CoinRequest.objects.create(user=self.author, coins=coins, amount=coins * 10,
                                                 method='khalti', reference=f'r-{coins}')
            CoinRequest.objects.filter(pk=request.pk).update(created_at=timezone.now() - timedelta(minutes=5))
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='coin_rush')
        self.assertEqual(row.context['requests'], 2)
        self.assertIn('130 coins are being asked for', row.detail)

    def test_uploads_past_their_own_ceiling_are_counted_from_the_disk_it_saw(self):
        big = {'state': 'ok', 'bytes': int(7.5 * 1024 ** 3), 'files': 900, 'by_kind': {}, 'detail': ''}
        alerts.scan(media=big)
        row = AdminAlert.objects.get(kind='storage_high')
        self.assertEqual(row.context['limit_gb'], 5.0)
        self.assertEqual(row.href, alerts.ALERT_DESK)

    def test_a_volume_that_will_not_tell_is_never_read_as_empty(self):
        """An unknown is not a zero: no disk, no alert, no lie about free space."""
        unknown = {'state': 'unknown', 'bytes': 0, 'files': 0, 'by_kind': {}, 'detail': ''}
        raised = alerts.scan(media=unknown)
        self.assertNotIn('storage_high', [item.kind for item in raised])


class PulseTests(AlertTestCase):
    def test_a_wire_nobody_connected_is_its_own_honest_alert(self):
        raised = {(item.key, item.severity) for item in alerts.scan(media=MEDIA_DISK)}
        for key in alerts.PULSES:
            self.assertIn((f'{key}:silent', AdminAlert.Severity.INFO), raised)
        row = AdminAlert.objects.get(key='backup:silent')
        self.assertIn('No backup job has ever reported', row.detail)
        self.assertEqual(row.href, '/exports')

    def test_the_desk_lists_the_wires_with_the_command_that_would_start_one(self):
        lines = alerts.pulses()
        self.assertEqual([line['key'] for line in lines], list(alerts.PULSES))
        web = next(line for line in lines if line['key'] == 'web')
        self.assertFalse(web['wired'])
        self.assertEqual(web['state'], 'never')
        self.assertIn('manage.py adminpulse web', web['command'])
        self.assertEqual(web['quiet_after'], 10)

    def test_a_probe_that_has_gone_quiet_is_a_different_trouble_from_a_probe_that_failed(self):
        AdminPulse.objects.create(key='web', label='The public site', state=AdminPulse.State.OK,
                                  detail='200 in 120 ms',
                                  stamped_at=timezone.now() - timedelta(minutes=40))
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(key='web:stale')
        self.assertEqual(row.severity, AdminAlert.Severity.CRITICAL)
        self.assertEqual(row.context['age_minutes'], 40)
        self.assertFalse(AdminAlert.objects.filter(key='web:silent').exists())

    def test_a_reporter_that_says_it_failed_is_not_replaced_by_a_quiet_row(self):
        AdminPulse.objects.create(key='backup', label='Backups', state=AdminPulse.State.FAIL,
                                  detail='pg_dump ran out of space')
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(key='backup:failing')
        self.assertIn('pg_dump ran out of space', row.detail)
        self.assertNotIn('backup:stale', AdminAlert.objects.values_list('key', flat=True))

    def test_silence_from_the_error_collector_is_not_an_alert(self):
        """A day with no bugs is exactly as quiet as a deploy that stopped shipping them."""
        AdminPulse.objects.create(key='errors', label='App errors', state=AdminPulse.State.OK, detail='none',
                                  stamped_at=timezone.now() - timedelta(days=3))
        alerts.scan(media=MEDIA_DISK)
        self.assertNotIn('errors:stale', AdminAlert.objects.values_list('key', flat=True))

    def test_an_error_rate_over_its_ceiling_is_read_straight_off_the_stamp(self):
        AdminPulse.objects.create(key='errors', label='App errors', state=AdminPulse.State.OK,
                                  detail='Sentry says 60 in the hour', counts={'per_hour': 60})
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(key='errors:backlog')
        self.assertEqual(row.context['waiting'], 60)

    def test_a_processing_queue_reports_both_its_backlog_and_its_silence(self):
        AdminPulse.objects.create(key='jobs', label='Media processing', state=AdminPulse.State.OK,
                                  detail='workers up', counts={'waiting': 61})
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(key='jobs:backlog')
        self.assertEqual(row.context['limit'], 50)

        AdminPulse.objects.filter(key='jobs').update(counts={'waiting': 2},
                                                     stamped_at=timezone.now() - timedelta(minutes=45))
        alerts.scan(media=MEDIA_DISK)
        self.assertEqual(AdminAlert.objects.get(key='jobs:backlog').status, AdminAlert.Status.RESOLVED,
                         'a queue that drained leaves the feed but stays in the history')
        self.assertEqual(AdminAlert.objects.get(key='jobs:stale').status, AdminAlert.Status.OPEN)


class AlertDeskTests(AlertTestCase):
    def test_the_desk_answers_the_three_questions_separately(self):
        self.reporters(3)
        self.desk.post(SCAN_URL, {}, format='json')
        got = self.desk.get(DESK_URL)
        self.assertEqual(got.status_code, 200)
        for key in ('counts', 'rows', 'kinds', 'thresholds', 'pulses', 'statuses', 'severities', 'health',
                    'generated_at', 'shown'):
            self.assertIn(key, got.data)
        self.assertEqual(got.data['counts']['open'], len(got.data['rows']))

    def test_the_history_walks_only_what_a_seat_asks_for(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        self.assertEqual(self.desk.get(f'{DESK_URL}?kind=report_pile').data['shown'], 1)
        self.assertEqual(self.desk.get(f'{DESK_URL}?kind=coin_rush').data['shown'], 0)

        before = self.desk.get(f'{DESK_URL}?severity=critical').data['shown']
        AdminAlert.objects.filter(kind='report_pile').update(severity=AdminAlert.Severity.CRITICAL)
        self.assertEqual(self.desk.get(f'{DESK_URL}?severity=critical').data['shown'], before + 1)
        self.assertEqual(self.desk.get(f'{DESK_URL}?severity=critical&kind=report_pile').data['shown'], 1)

    def test_a_status_that_is_not_one_of_the_four_is_refused_in_words(self):
        got = self.desk.get(f'{DESK_URL}?status=disappeared')
        self.assertEqual(got.status_code, 400)
        self.assertIn('active, open, acknowledged', got.data['detail'])

    def test_the_page_size_stays_inside_any_sane_bound(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        self.assertEqual(self.desk.get(f'{DESK_URL}?limit=1').data['shown'], 1)
        self.assertLessEqual(self.desk.get(f'{DESK_URL}?limit=nonsense').data['shown'], 500)

    def test_the_kinds_list_carries_the_still_true_rows_apart_from_the_closed_ones(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        kinds = {item['kind']: item for item in self.desk.get(DESK_URL).data['kinds']}
        self.assertEqual(kinds['report_pile']['active'], 1)
        self.assertEqual(kinds['report_pile']['resolved'], 0)
        self.assertEqual(kinds['report_pile']['label'], 'One post, many reporters')

    def test_acknowledging_an_alert_does_not_claim_to_have_fixed_anything(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='report_pile')
        marked = self.desk.post(f'/api/admin/alerts/{row.pk}/mark/', {'to': 'ack'}, format='json')
        self.assertEqual(marked.status_code, 200)
        self.assertIn('Still true until the next scan', marked.data['detail'])
        self.assertEqual(marked.data['alert']['acked_by'], 'client_owner')
        self.assertTrue(AuditLog.objects.filter(action='alert_ack', actor=self.owner).exists())

    def test_resolving_by_hand_reopens_it_when_the_condition_is_still_true(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='report_pile')
        self.desk.post(f'/api/admin/alerts/{row.pk}/mark/', {'to': 'resolve'}, format='json')
        self.assertEqual(AdminAlert.objects.get(pk=row.pk).status, AdminAlert.Status.RESOLVED)
        alerts.scan(media=MEDIA_DISK)
        again = AdminAlert.objects.get(pk=row.pk)
        self.assertEqual(again.status, AdminAlert.Status.OPEN)
        self.assertIsNone(again.resolved_at)
        self.assertEqual(AdminAlert.objects.filter(kind='report_pile').count(), 1,
                         'one row per condition, or the history reads as two problems')

    def test_marking_something_that_is_not_there_or_with_a_verb_that_is_not_one(self):
        self.assertEqual(self.desk.post('/api/admin/alerts/999999/mark/', {'to': 'ack'}, format='json').status_code,
                         404)
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        row = AdminAlert.objects.get(kind='report_pile')
        refused = self.desk.post(f'/api/admin/alerts/{row.pk}/mark/', {'to': 'bury'}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertIn('acknowledge or resolve', refused.data['detail'])

    def test_the_scan_button_put_on_the_record_who_pressed_it(self):
        out = self.desk.post(SCAN_URL, {}, format='json')
        self.assertEqual(out.status_code, 200)
        row = AuditLog.objects.filter(action='alert_scan').first()
        self.assertIsNotNone(row)
        self.assertEqual(row.actor, self.owner)
        self.assertIn('condition(s) true', row.detail)
        self.assertEqual(out.data['counts']['open'], len(out.data['feed']))

    def test_the_desk_does_not_rewrite_history_every_time_somebody_looks(self):
        """`overview` already scans; a second scan per page load would double `occurrences`."""
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        before = AdminAlert.objects.get(kind='report_pile').occurrences
        self.desk.get(DESK_URL)
        self.assertEqual(AdminAlert.objects.get(kind='report_pile').occurrences, before)


class ThresholdDoorTests(AlertTestCase):
    def test_a_dial_that_is_not_a_number_is_refused_and_not_written(self):
        refused = self.desk.post(THRESHOLDS_URL, {'alert_report_spike': 'soon'}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertIn('has to be a number', refused.data['detail'])
        self.assertFalse(AdminSetting.objects.filter(key='alert_report_spike').exists())

    def test_a_negative_dial_is_refused_because_no_check_reads_it_that_way(self):
        self.assertEqual(self.desk.post(THRESHOLDS_URL, {'alert_storage_gb': '-4'}, format='json').status_code, 400)

    def test_moving_a_dial_is_written_down_and_the_next_scan_uses_it(self):
        self.reporters(3)
        alerts.scan(media=MEDIA_DISK)
        self.assertTrue(AdminAlert.objects.filter(kind='report_pile').exists())

        saved = self.desk.post(THRESHOLDS_URL, {'alert_report_pile': '10'}, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertIn('alert_report_pile', saved.data['changed'])
        self.assertTrue(AuditLog.objects.filter(action='alert_thresholds', actor=self.owner).exists())

        alerts.scan(media=MEDIA_DISK)
        self.assertEqual(AdminAlert.objects.get(kind='report_pile').status, AdminAlert.Status.RESOLVED,
                         'a dial moved high enough closes what it no longer believes, on the record')

    def test_returning_a_dial_to_blank_puts_the_shipped_default_back(self):
        self.desk.post(THRESHOLDS_URL, {'alert_report_pile': '7'}, format='json')
        self.desk.post(THRESHOLDS_URL, {'alert_report_pile': ''}, format='json')
        self.assertEqual(settings_store.get('alert_report_pile'), settings_store.DEFAULTS['alert_report_pile'][0])

    def test_a_body_that_touches_no_dial_is_refused_rather_than_saved_as_nothing(self):
        refused = self.desk.post(THRESHOLDS_URL, {'coin_price': '999'}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertFalse(AdminSetting.objects.filter(key='coin_price').exists())

    def test_the_desk_is_a_safety_key_and_a_moderator_is_turned_away_with_the_name_of_it(self):
        night = self.session('night_mod')
        for url in (DESK_URL, SCAN_URL, THRESHOLDS_URL):
            refused = night.post(url, {}, format='json') if url != DESK_URL else night.get(url)
            self.assertEqual(refused.status_code, 403, url)
            self.assertEqual(refused.data['permission'], 'alerts', url)

    def test_a_member_with_a_signed_in_cookie_gets_nothing_from_the_alert_desk(self):
        plain = APIClient()
        self.assertIn(plain.get(DESK_URL).status_code, (401, 403))
        signed_up = make_user('nosy_member', password='Test-Pass-9271')
        plain.cookies['exposing_access'] = issue_access(signed_up)
        turned_away = plain.get(DESK_URL)
        self.assertEqual(turned_away.status_code, 403)
        self.assertEqual(turned_away.data['code'], 'staff_only')


class AdminPulseCommandTests(AlertTestCase):
    def test_the_first_word_from_a_wire_makes_it_readable(self):
        call_command('adminpulse', 'backup', '--state=ok', '--detail=nightly dump, 2.1 GB')
        row = AdminPulse.objects.get(key='backup')
        self.assertEqual(row.label, 'Backup')
        self.assertEqual(row.stamps, 1)
        self.assertEqual(row.detail, 'nightly dump, 2.1 GB')

    def test_reporting_twice_bumps_the_count_rather_than_making_two_rows(self):
        call_command('adminpulse', 'web', '--detail=200 in 90 ms')
        call_command('adminpulse', 'web', '--detail=200 in 110 ms', '--counts={"p95_ms": 110}')
        self.assertEqual(AdminPulse.objects.count(), 1)
        row = AdminPulse.objects.get(key='web')
        self.assertEqual(row.stamps, 2)
        self.assertEqual(row.detail, '200 in 110 ms')
        self.assertEqual(row.counts, {'p95_ms': 110})

    def test_counts_that_are_not_an_object_are_refused_before_anything_is_written(self):
        with self.assertRaises(CommandError) as bad:
            call_command('adminpulse', 'jobs', '--counts=41')
        self.assertIn('JSON object', str(bad.exception))
        self.assertFalse(AdminPulse.objects.filter(key='jobs').exists())

        with self.assertRaises(CommandError):
            call_command('adminpulse', 'jobs', '--stamped-at=last tuesday')
        self.assertFalse(AdminPulse.objects.filter(key='jobs').exists())

    def test_a_backfilled_stamp_is_read_as_a_real_one_by_the_desk(self):
        call_command('adminpulse', 'backup', '--stamped-at=2026-11-01T03:04:05', '--detail=replayed')
        row = AdminPulse.objects.get(key='backup')
        self.assertEqual(row.stamped_at.year, 2026)
        alerts.scan(media=MEDIA_DISK)
        self.assertIn('backup:stale', AdminAlert.objects.values_list('key', flat=True))

    def test_the_list_says_so_when_nothing_has_ever_reported(self):
        out = StringIO()
        call_command('adminpulse', '--list', stdout=out)
        self.assertIn('Nothing has ever reported', out.getvalue())

        call_command('adminpulse', 'jobs', '--detail=3 workers up')
        out = StringIO()
        call_command('adminpulse', '--list', stdout=out)
        self.assertIn('jobs', out.getvalue())
        self.assertIn('3 workers up', out.getvalue())
