"""Contract 6.10, 2,000 characters, four photos of 5 MB, one video of 60 s and 150 MB.

The clause is a list of numbers and one requirement: an Admin changes them without a
code change. So the tests check the numbers themselves are the contract's, that a
typed number reaches an open door a browser can read without a seat, and that a box
that takes `0` or `four` is refused in the words a person typed it with.

The part worth more tests than the rest is the honesty about what the platform refuses
today. The upload endpoint has one ceiling, 150 MB per file, and the composer's four
photos and sixty seconds have only ever lived in the React component. A desk that saved
"20 photos" and said nothing would leave a seat believing the site now takes twenty.
So the desk prints the server's real limit next to the six dials, and saving a number
above it comes back with the sentence that says which code has to read the published
config before the file actually lands.
"""

from unittest import mock

from rest_framework.test import APIClient

from apps.accounts.auth import issue_access
from apps.common.testutils import make_user
from apps.moderation.models import AuditLog

from . import limits, settings_store
from .models import AdminSetting, StaffAccount
from .tests_staff import RbacTestCase

DESK_URL = '/api/admin/limits/'
CONFIG_URL = '/api/limits/config/'


class DeskTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        self.desk = self.session('client_owner')

    def test_the_six_numbers_the_contract_names_are_the_ones_the_desk_opens_with(self):
        got = self.desk.get(DESK_URL)
        self.assertEqual(got.status_code, 200)
        values = {line['key']: line['value'] for block in got.data['blocks'] for line in block['lines']}
        self.assertEqual(values, {'limit_text_chars': 2000, 'limit_photo_count': 4, 'limit_photo_mb': 5,
                                  'limit_video_count': 1, 'limit_video_seconds': 60, 'limit_video_mb': 150})
        self.assertEqual([block['id'] for block in got.data['blocks']], ['text', 'photo', 'video'])

    def test_every_dial_carries_the_span_it_will_accept_and_which_row_is_already_turned(self):
        lines = {line['key']: line for block in self.desk.get(DESK_URL).data['blocks'] for line in block['lines']}
        self.assertEqual(lines['limit_photo_count']['range'], [1, 20])
        self.assertFalse(lines['limit_photo_count']['set'], 'a default nobody moved is said so')
        self.desk.post(DESK_URL, {'limit_photo_count': '6'}, format='json')
        after = {line['key']: line for block in self.desk.get(DESK_URL).data['blocks'] for line in block['lines']}
        self.assertTrue(after['limit_photo_count']['set'])
        self.assertEqual(after['limit_photo_count']['value'], 6)

    def test_the_desk_prints_what_the_server_actually_refuses_today(self):
        guard = self.desk.get(DESK_URL).data['server']
        self.assertEqual(guard['upload_mb'], 150)
        self.assertIn('image/jpeg', guard['kinds'])
        self.assertIn('video/mp4', guard['kinds'])

    def test_a_seat_that_cannot_write_sees_the_same_numbers_with_the_pen_marked_off(self):
        self.assertFalse(limits.desk(StaffAccount.objects.get(user=self.mod))['can_write'])
        self.assertTrue(limits.desk(StaffAccount.for_user(self.owner))['can_write'])

    def test_a_number_already_over_the_servers_own_ceiling_is_flagged_on_sight(self):
        self.desk.post(DESK_URL, {'limit_video_mb': '400'}, format='json')
        desk = self.desk.get(DESK_URL)
        self.assertTrue(desk.data['oversized'], 'a 400 MB video limit the upload endpoint will not honour')
        self.assertIn('/api/limits/config/', desk.data['oversized'][0])


class WriteTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        self.desk = self.session('client_owner')

    def test_a_typed_limit_reaches_the_door_the_site_reads_without_a_login(self):
        saved = self.desk.post(DESK_URL, {'limit_text_chars': '5000', 'limit_video_seconds': '180'},
                               format='json')
        self.assertEqual(saved.status_code, 200)
        answered = APIClient().get(CONFIG_URL)
        self.assertEqual(answered.status_code, 200, 'a composer asks before anybody signs in')
        self.assertEqual(answered.data['text']['characters'], 5000)
        self.assertEqual(answered.data['video']['seconds'], 180)

    def test_the_open_door_carries_bytes_as_well_as_the_number_a_person_reads(self):
        answered = APIClient().get(CONFIG_URL)
        self.assertEqual(answered.data['photo']['each_bytes'], 5 * 1024 ** 2)
        self.assertEqual(answered.data['video']['each_bytes'], 150 * 1024 ** 2)
        self.assertEqual(answered.data['server_upload_mb'], 150)
        for block in ('text', 'photo', 'video'):
            self.assertIn(block, answered.data)

    def test_a_zero_is_refused_because_no_composer_can_be_built_for_zero_photos(self):
        for key in ('limit_photo_count', 'limit_video_count', 'limit_text_chars'):
            refused = self.desk.post(DESK_URL, {key: '0'}, format='json')
            self.assertEqual(refused.status_code, 400, key)
            self.assertIn('between 1 and', refused.data['detail'], key)
        self.assertFalse(AdminSetting.objects.filter(key__startswith='limit_').exists())

    def test_a_number_that_is_not_a_number_is_refused_in_the_words_it_was_typed_with(self):
        refused = self.desk.post(DESK_URL, {'limit_text_chars': 'as long as it takes'}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertIn('whole number', refused.data['detail'])

    def test_a_ceiling_past_the_point_a_limit_becomes_a_typo_is_refused(self):
        refused = self.desk.post(DESK_URL, {'limit_photo_count': '400'}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertIn('photos in one post', refused.data['detail'])

    def test_saving_a_video_over_what_the_upload_endpoint_takes_is_honest_about_both(self):
        saved = self.desk.post(DESK_URL, {'limit_video_mb': '300'}, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.data['warnings'])
        self.assertIn('turned away by the upload endpoint', saved.data['warnings'][0])
        self.assertEqual(saved.data['config']['video']['each_mb'], 300)

    def test_the_desk_writes_one_audit_row_naming_every_number_it_changed(self):
        self.desk.post(DESK_URL, {'limit_photo_count': '5', 'limit_video_seconds': '90'}, format='json')
        entry = AuditLog.objects.filter(action='post_limits').first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.actor.username, 'client_owner')
        self.assertIn('photos in one post', entry.detail.lower())
        self.assertIn('length of one video', entry.detail.lower())

    def test_a_body_that_touches_no_dial_is_refused_rather_than_saved_as_nothing(self):
        refused = self.desk.post(DESK_URL, {'spam_post_per_hour': '2'}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertFalse(AdminSetting.objects.filter(key='spam_post_per_hour').exists())

    def test_the_shipped_default_wins_again_the_moment_a_number_is_handed_back(self):
        self.desk.post(DESK_URL, {'limit_photo_count': '9'}, format='json')
        self.assertEqual(APIClient().get(CONFIG_URL).data['photo']['per_post'], 9)
        AdminSetting.objects.filter(key='limit_photo_count').update(value='')
        self.assertEqual(APIClient().get(CONFIG_URL).data['photo']['per_post'],
                         settings_store.DEFAULTS['limit_photo_count'][0])


class GateTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)

    def test_reading_and_moving_the_numbers_is_its_own_key(self):
        night = self.session('night_mod')
        got = night.get(DESK_URL)
        self.assertEqual(got.status_code, 403)
        self.assertEqual(got.data['permission'], 'post_limits')
        refused = night.post(DESK_URL, {'limit_text_chars': '500'}, format='json')
        self.assertEqual(refused.status_code, 403)
        self.assertFalse(AdminSetting.objects.filter(key='limit_text_chars').exists())

    def test_a_member_with_a_signed_in_cookie_changes_nothing_about_post_sizes(self):
        plain = APIClient()
        self.assertIn(plain.get(DESK_URL).status_code, (401, 403))
        plain.cookies['exposing_access'] = issue_access(make_user('nosy_member', password='Test-Pass-9271'))
        turned_away = plain.get(DESK_URL)
        self.assertEqual(turned_away.status_code, 403)
        self.assertEqual(turned_away.data['code'], 'staff_only')

    def test_the_open_door_answers_for_nobody_signed_in_at_all(self):
        answered = APIClient().get(CONFIG_URL)
        self.assertEqual(answered.status_code, 200)
        self.assertEqual(answered.data['text']['characters'], 2000)


class GuardTests(RbacTestCase):
    """The sentence for a number the server cannot honour has to track the server."""

    def test_the_warning_is_computed_from_the_ceiling_the_endpoint_actually_uses(self):
        with mock.patch.object(limits.uploads, 'MAX_BYTES', 40 * 1024 ** 2):
            self.assertEqual(limits.server_guard()['upload_mb'], 40)
            self.assertTrue(limits.warned('limit_photo_mb', 41))
            self.assertIsNone(limits.warned('limit_photo_mb', 39))
            self.assertTrue(limits.warned('limit_video_mb', 41))

    def test_the_length_of_a_video_is_never_the_upload_endpoints_problem(self):
        """Seconds are counted by the browser; only bytes are refused by the API."""
        self.assertIsNone(limits.warned('limit_video_seconds', 900))
        self.assertIsNone(limits.warned('limit_text_chars', 100000))
