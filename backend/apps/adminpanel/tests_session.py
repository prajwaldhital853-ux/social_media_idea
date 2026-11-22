"""Contract 6.1: the console is staff-only, and a password alone never opens it."""

from datetime import datetime, timedelta
from datetime import timezone as clock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.common.testutils import auth_client, make_user

from . import totp
from .models import StaffAccount
from .tokens import ADMIN_COOKIE, SETUP_COOKIE, issue_admin_token

PASSWORD = 'Test-Pass-9271'
LOGIN_URL = '/api/admin/session/login/'
VERIFY_URL = '/api/admin/session/verify/'
SESSION_URL = '/api/admin/session/'
LOGOUT_URL = '/api/admin/session/logout/'
EPOCH = datetime(1970, 1, 1, tzinfo=clock.utc)


def carry(client, response):
    """Keep what the response set: the test client hands back cookies, not state.

    The double-submit header is refreshed here too, because the admin login and
    verify routes are not in `apps.common.security.CSRF_EXEMPT_PATHS` — that file
    belongs to the main site, and once a jar holds `exposing_access` the middleware
    expects the header on every write. The dashboard sends it the same way.
    """
    for name, morsel in response.cookies.items():
        client.cookies[name] = morsel.value
    with_csrf(client)
    return client


def with_csrf(client):
    """The double-submit header the security middleware expects on writes."""
    if 'exposing_csrf' in client.cookies:
        client.credentials(HTTP_X_CSRF_TOKEN=client.cookies['exposing_csrf'].value)
    return client


def first_sign_in(client, username='owner'):
    """The very first staff sign-in: password, enrolment QR, code. Returns (granted, started)."""
    started = client.post(LOGIN_URL, {'username': username, 'password': PASSWORD}, format='json')
    carry(client, started)
    secret = started.data['totp']['secret']
    granted = client.post(VERIFY_URL, {'code': totp.totp(secret)}, format='json')
    carry(client, granted)
    return granted, started.data


def code_sign_in(client, code, username='owner'):
    """Every later sign-in: password, then the code the authenticator is showing."""
    started = client.post(LOGIN_URL, {'username': username, 'password': PASSWORD}, format='json')
    carry(client, started)
    granted = client.post(VERIFY_URL, {'code': code}, format='json')
    carry(client, granted)
    return granted, started.data


class TotpVectorTests(TestCase):
    """The RFC 6238 Appendix B vectors, so "hand-rolled" also means "verified"."""

    SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'  # base32 of b'12345678901234567890'

    def test_rfc6238_vectors(self):
        # Appendix B of RFC 6238, HMAC-SHA1 column — checked against the published
        # table rather than whatever this implementation happens to return.
        for seconds, expected in [(59, '94287082'), (1111111109, '07081804'),
                                  (1234567890, '89005924'), (2000000000, '69279037'),
                                  (20000000000, '65353130')]:
            at = EPOCH + timedelta(seconds=seconds)
            self.assertEqual(totp.hotp(totp._decode(self.SECRET), int(at.timestamp()) // 30, 8), expected)

    def test_one_step_of_clock_drift_still_gets_in(self):
        now = timezone.now()
        code = totp.totp(self.SECRET, at=now)
        self.assertTrue(totp.verify(self.SECRET, code, at=now + timedelta(seconds=29)))
        self.assertTrue(totp.verify(self.SECRET, code, at=now - timedelta(seconds=29)))
        self.assertFalse(totp.verify(self.SECRET, code, at=now + timedelta(minutes=5)))

    def test_leading_zeros_and_spaces_survive_a_pasted_code(self):
        secret = totp.new_secret()
        for step in range(300):
            at = EPOCH + timedelta(seconds=step * 30)
            code = totp.totp(secret, at=at)
            self.assertTrue(totp.verify(secret, f'  {code} ', at=at))

    def test_malformed_secret_is_refused(self):
        for bad in ('not base32!', ''):
            with self.assertRaises(ValueError):
                totp.verify(bad, '123456')


class AdminSignInTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = make_user('owner', password=PASSWORD, is_staff=True, is_superuser=True)
        self.member = make_user('plainmember', password=PASSWORD)

    def jar(self):
        """A fresh cookie jar: the jar is the session under test."""
        return APIClient()

    def test_ordinary_user_never_reaches_the_console_door(self):
        response = self.jar().post(LOGIN_URL, {'username': 'plainmember', 'password': PASSWORD}, format='json')
        self.assertEqual(response.status_code, 401)
        self.assertNotIn(SETUP_COOKIE, response.cookies)

    def test_wrong_password_and_unknown_account_read_identically(self):
        client = self.jar()
        known = client.post(LOGIN_URL, {'username': 'owner', 'password': 'not-the-password'}, format='json')
        ghost = client.post(LOGIN_URL, {'username': 'ghost', 'password': 'not-the-password'}, format='json')
        self.assertEqual(known.status_code, ghost.status_code)
        self.assertEqual(known.data['detail'], ghost.data['detail'])

    def test_enrolment_happens_before_any_session_is_minted(self):
        client = self.jar()
        started = client.post(LOGIN_URL, {'username': 'owner', 'password': PASSWORD}, format='json')
        self.assertEqual(started.status_code, 202)
        self.assertEqual(started.data['code'], 'two_factor_enrolment')
        self.assertTrue(started.data['totp']['otpauth_url'].startswith('otpauth://totp/Exposing:owner?secret='))
        carry(client, started)
        self.assertNotIn('exposing_access', client.cookies, 'a password alone must not mint a session')

        rejected = client.post(VERIFY_URL, {'code': '000001'}, format='json')
        self.assertEqual(rejected.status_code, 401)
        self.assertEqual(rejected.data['code'], 'code_rejected')

        granted = client.post(VERIFY_URL, {'code': totp.totp(started.data['totp']['secret'])}, format='json')
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.data['role'], 'superadmin')
        self.assertIn('overview', granted.data['permissions'])
        self.assertEqual(len(granted.data['recovery_codes']), 10)
        self.assertTrue(all(len(code) == 14 and code.count('-') == 2 for code in granted.data['recovery_codes']))
        self.assertIn(ADMIN_COOKIE, client.cookies)

        staff = StaffAccount.objects.get(user=self.owner)
        self.assertTrue(staff.is_enrolled)
        self.assertNotIn(started.data['totp']['secret'], staff.totp_secret, 'stored encrypted, never as handed to the QR')
        self.assertEqual(len(staff.recovery_codes), len(granted.data['recovery_codes']))

    def test_a_later_sign_in_asks_for_a_code_not_an_enrolment(self):
        client = self.jar()
        first_sign_in(client)
        again = client.post(LOGIN_URL, {'username': 'owner', 'password': PASSWORD}, format='json')
        self.assertEqual(again.status_code, 202)
        self.assertEqual(again.data['code'], 'two_factor_required')
        self.assertNotIn('totp', again.data)

    def test_five_wrong_codes_lock_the_authenticator(self):
        client = self.jar()
        started = client.post(LOGIN_URL, {'username': 'owner', 'password': PASSWORD}, format='json')
        carry(client, started)
        for _ in range(5):
            self.assertEqual(client.post(VERIFY_URL, {'code': '123456'}, format='json').status_code, 401)
        blocked = client.post(VERIFY_URL, {'code': totp.totp(started.data['totp']['secret'])}, format='json')
        self.assertEqual(blocked.status_code, 423)
        self.assertEqual(blocked.data['code'], 'two_factor_locked')
        self.assertGreater(blocked.data['retry_in'], 0)

    def test_a_recovery_code_signs_in_once(self):
        client = self.jar()
        granted, _started = first_sign_in(client)
        spare = granted.data['recovery_codes'][0]

        reused, _ = code_sign_in(client, spare)
        self.assertEqual(reused.status_code, 200)
        self.assertEqual(reused.data['amr'], ['recovery'])
        self.assertEqual(reused.data['recovery_left'], len(granted.data['recovery_codes']) - 1)

        spent, _ = code_sign_in(client, spare)
        self.assertEqual(spent.status_code, 401)

    def test_session_endpoint_reports_the_seat_and_the_window(self):
        client = with_csrf(self.jar())
        granted, _started = first_sign_in(client)
        session = client.get(SESSION_URL)
        self.assertEqual(session.status_code, 200)
        self.assertEqual(session.data['role'], 'superadmin')
        self.assertTrue(session.data['enrolled'])
        self.assertEqual(session.data['admin_expires_at'], granted.data['admin_expires_at'])
        # The console renders screens by name, so each key arrives labelled.
        self.assertEqual(
            [entry['key'] for entry in session.data['permission_keys']], session.data['permissions'])
        self.assertTrue(all(entry['label'] for entry in session.data['permission_keys']))

    def test_a_never_enrolled_seat_is_told_to_enrol(self):
        response = auth_client(self.owner).get(SESSION_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'two_factor_enrolment')

    def test_an_access_cookie_without_the_second_factor_is_not_enough(self):
        first_sign_in(self.jar())
        response = auth_client(self.owner).get(SESSION_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'two_factor_required')

    def test_a_non_staff_session_is_turned_away_outright(self):
        response = auth_client(self.member).get(SESSION_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'staff_only')

    def test_an_expired_admin_window_is_refused(self):
        client = self.jar()
        first_sign_in(client)
        client.cookies[ADMIN_COOKIE] = issue_admin_token(self.owner, ttl=timedelta(seconds=-1))
        response = client.get(SESSION_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'two_factor_required')

    def test_a_token_forged_for_another_person_is_refused(self):
        client = self.jar()
        first_sign_in(client)
        client.cookies[ADMIN_COOKIE] = issue_admin_token(self.member)
        response = client.get(SESSION_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'two_factor_required')

    def test_logout_clears_both_cookies(self):
        client = self.jar()
        first_sign_in(client)
        client.post(LOGOUT_URL, {}, format='json')
        # 401 when the browser dropped the session cookie, 403 when it kept the
        # session but lost the admin window: either way the console is closed.
        self.assertIn(client.get(SESSION_URL).status_code, (401, 403))

    def test_the_second_factor_does_not_lock_staff_out_of_the_main_site(self):
        # Clause 4.4 restricts the admin area. Staff are still members, and the
        # platform's own suites sign in as the demo staff account through /api/auth/.
        self.owner.profile.two_step = False
        self.owner.profile.save(update_fields=['two_step'])
        response = self.jar().post('/api/auth/login/', {'username': 'owner', 'password': PASSWORD, 'device_id': 'main-site'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIn('exposing_access', response.cookies)
        self.assertNotIn(ADMIN_COOKIE, response.cookies)
