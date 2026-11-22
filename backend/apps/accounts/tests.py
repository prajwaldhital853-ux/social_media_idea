import itertools
from datetime import timedelta

from django.core.cache import cache
from django.db import connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.management.commands.seed_demo import Command
from apps.accounts.models import DeviceTrust, EmailOTP, RefreshSession, User
from apps.common.testutils import auth_client, make_user

_ips = itertools.count(1)


def fresh_ip():
    n = next(_ips)
    return f'10.66.{n // 250}.{n % 250 + 1}'


def signup_payload(username, **extra):
    body = {
        'username': username, 'email': f'{username}@test.local', 'password': 'Test-Pass-9271',
        'name': username.title(), 'dob': '1998-04-12', 'country': 'Nepal', 'city': 'Kathmandu',
        'device_id': f'dev-{username}',
    }
    body.update(extra)
    return body


@override_settings(DEBUG=True)
class SignupTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())

    def test_signup_stays_closed_until_the_email_is_confirmed(self):
        resp = self.client.post('/api/auth/signup/', signup_payload('alice'), format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertIn('challenge', resp.data)
        self.assertIn('dev_code', resp.data)
        self.assertNotIn('user', resp.data)
        user = User.objects.get(username='alice')
        self.assertTrue(hasattr(user, 'profile'))
        self.assertTrue(hasattr(user, 'wallet'))
        self.assertFalse(user.email_verified)
        # The account exists, but nobody is signed in until the code is entered.
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        resp = self.client.post('/api/auth/otp/',
                                {'challenge': resp.data['challenge'], 'code': resp.data['dev_code']}, format='json')
        self.assertEqual(resp.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        me = self.client.get('/api/auth/me/')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data['username'], 'alice')

    def test_signup_validation(self):
        cases = [
            signup_payload('ab'),
            signup_payload('bad name!'),
            signup_payload('okname', email='not-an-email'),
            signup_payload('okname', password='short'),
            signup_payload('okname', dob=''),
            signup_payload('okname', country=''),
        ]
        for body in cases:
            self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
            resp = self.client.post('/api/auth/signup/', body, format='json')
            self.assertEqual(resp.status_code, 400, body)
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
        self.client.post('/api/auth/signup/', signup_payload('taken'), format='json')
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
        resp = self.client.post('/api/auth/signup/', signup_payload('taken', email='other@test.local'), format='json')
        self.assertEqual(resp.status_code, 400)
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
        resp = self.client.post('/api/auth/signup/', signup_payload('other', email='taken@test.local'), format='json')
        self.assertEqual(resp.status_code, 400)

    def test_signup_rate_limit_three_per_hour(self):
        ip = fresh_ip()
        self.client.credentials(HTTP_X_FORWARDED_FOR=ip)
        codes = [
            self.client.post('/api/auth/signup/', signup_payload(f'rl{i}'), format='json').status_code
            for i in range(4)
        ]
        self.assertEqual(codes, [201, 201, 201, 429])

    def test_verify_otp_marks_email_verified(self):
        resp = self.client.post('/api/auth/signup/', signup_payload('verifyme'), format='json')
        challenge, code = resp.data['challenge'], resp.data['dev_code']
        wrong = self.client.post('/api/auth/otp/', {'challenge': challenge, 'code': '000000' if code != '000000' else '111111'}, format='json')
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(wrong.data['attempts_left'], 4)
        ok = self.client.post('/api/auth/otp/', {'challenge': challenge, 'code': code}, format='json')
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(User.objects.get(username='verifyme').email_verified)

    def test_otp_expiry_and_attempt_cap(self):
        resp = self.client.post('/api/auth/signup/', signup_payload('expireme'), format='json')
        challenge = resp.data['challenge']
        EmailOTP.objects.filter(pk=challenge).update(expires_at=timezone.now() - timedelta(minutes=1))
        resp = self.client.post('/api/auth/otp/', {'challenge': challenge, 'code': '123456'}, format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post('/api/auth/signup/', signup_payload('capme'), format='json')
        challenge, code = resp.data['challenge'], resp.data['dev_code']
        wrong_code = '000000' if code != '000000' else '111111'
        for i in range(5):
            resp = self.client.post('/api/auth/otp/', {'challenge': challenge, 'code': wrong_code}, format='json')
            self.assertEqual(resp.status_code, 400)
        resp = self.client.post('/api/auth/otp/', {'challenge': challenge, 'code': code}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Too many', resp.data['detail'])

    def test_otp_resend_invalidates_old_and_limits(self):
        resp = self.client.post('/api/auth/signup/', signup_payload('resendme'), format='json')
        old = resp.data['challenge']
        for _ in range(3):
            resp = self.client.post('/api/auth/otp/resend/', {'challenge': old}, format='json')
            self.assertEqual(resp.status_code, 200)
            old = resp.data['challenge']
        resp = self.client.post('/api/auth/otp/resend/', {'challenge': old}, format='json')
        self.assertEqual(resp.status_code, 429)
        first = EmailOTP.objects.filter(user__username='resendme').order_by('pk').first()
        self.assertIsNotNone(first.consumed_at)


@override_settings(DEBUG=True)
class LoginLockoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('lockme')
        self.client = APIClient()
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())

    def login(self, password, device='dev-lockme', client=None):
        return (client or self.client).post(
            '/api/auth/login/', {'email': self.user.email, 'password': password, 'device_id': device}, format='json',
        )

    def test_new_device_requires_otp_then_trusted(self):
        resp = self.login('Test-Pass-9271')
        self.assertEqual(resp.status_code, 202)
        self.assertTrue(resp.data['new_device'])
        resp = self.client.post('/api/auth/otp/', {'challenge': resp.data['challenge'], 'code': resp.data['dev_code'], 'device_id': 'dev-lockme'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(DeviceTrust.objects.filter(user=self.user, device_id='dev-lockme').exists())
        resp = self.login('Test-Pass-9271')
        self.assertEqual(resp.status_code, 200)

    def test_three_wrong_passwords_lock_for_the_cooloff(self):
        for i in range(2):
            resp = self.login('wrong-password')
            self.assertEqual(resp.status_code, 401)
            self.assertEqual(resp.data['attempts_left'], 2 - i)
        resp = self.login('wrong-password')
        self.assertEqual(resp.status_code, 423)
        self.assertTrue(resp.data['locked'])
        self.assertEqual(resp.data['retry_in'], 5 * 60)
        # The cooloff expires on its own, so this path sends no rescue email.
        self.assertNotIn('challenge', resp.data)
        resp = self.login('Test-Pass-9271')
        self.assertEqual(resp.status_code, 423)
        self.assertLessEqual(resp.data['retry_in'], 5 * 60)

    def test_lock_expires_after_window(self):
        for _ in range(3):
            self.login('wrong-password')
        User.objects.filter(pk=self.user.pk).update(locked_until=timezone.now() - timedelta(minutes=1))
        resp = self.login('Test-Pass-9271')
        self.assertIn(resp.status_code, (200, 202))

    def test_expired_cooloff_restores_the_three_attempts(self):
        for _ in range(3):
            self.login('wrong-password')
        User.objects.filter(pk=self.user.pk).update(locked_until=timezone.now() - timedelta(seconds=1))
        resp = self.login('wrong-password')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.data['attempts_left'], 2)

    def test_unlock_request_unknown_email_is_generic(self):
        resp = self.client.post('/api/auth/unlock/', {'email': 'ghost@test.local'}, format='json')
        self.assertEqual(resp.status_code, 200)
        resp = self.client.post('/api/auth/unlock/', {'email': self.user.email}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('challenge', resp.data)

    def test_unlock_request_needs_the_email(self):
        # Sign-in is email-only now, so the unlock form must not promise a way in
        # through a handle that the password box no longer accepts.
        resp = self.client.post('/api/auth/unlock/', {'email': self.user.username}, format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post('/api/auth/unlock/', {'email': self.user.email}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('challenge', resp.data)

    def test_username_is_not_a_way_in(self):
        body = {'username': 'lockme', 'password': 'Test-Pass-9271', 'device_id': 'dev-lockme'}
        resp = self.client.post('/api/auth/login/', body, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('email', resp.data['detail'].lower())
        # A handle is public and changeable, so it must not reach an account even
        # when somebody else has registered it as their email.
        resp = self.client.post('/api/auth/login/', {'email': 'lockme', 'password': 'Test-Pass-9271'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_unverified_email_gets_the_message_and_a_new_code(self):
        User.objects.filter(pk=self.user.pk).update(email_verified=False)
        resp = self.login('Test-Pass-9271')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(resp.data['email_not_verified'])
        self.assertIn('not verified', resp.data['detail'])
        self.assertEqual(resp.data['email_hint'], self.user.email)
        self.assertIn('dev_code', resp.data)
        # The password was right, so none of the lock budget was spent on it.
        self.user.refresh_from_db()
        self.assertEqual(self.user.failed_attempts, 0)
        # And the code it sent works as the way in.
        resp = self.client.post('/api/auth/otp/', {
            'challenge': resp.data['challenge'], 'code': resp.data['dev_code'], 'device_id': 'dev-lockme',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.email_verified)

    def test_login_ip_rate_limit(self):
        ip = fresh_ip()
        self.client.credentials(HTTP_X_FORWARDED_FOR=ip)
        responses = [self.login('wrong-password') for _ in range(11)]
        codes = [r.status_code for r in responses]
        # Two wrong passwords, then the lock answers 423 for every try until the
        # per-minute cap of ten is spent: the cooloff, not the counter, is what
        # keeps a persistent guesser out.
        self.assertEqual(codes[:2], [401, 401])
        self.assertEqual(set(codes[2:10]), {423})
        self.assertEqual(codes[10], 429)
        # The refusal is shown to a person, so it says what to do and for how long.
        self.assertIn('Too many attempts', responses[10].data['detail'])
        self.assertGreater(responses[10].data['retry_in'], 0)

    def test_suspended_account_cannot_login(self):
        User.objects.filter(pk=self.user.pk).update(suspended_until=timezone.now() + timedelta(days=1), suspend_reason='spam')
        resp = self.login('Test-Pass-9271')
        self.assertEqual(resp.status_code, 403)

    def test_blank_identifier_never_matches(self):
        # An empty form must not fall through to a user whose email is also blank.
        User.objects.filter(pk=self.user.pk).update(email='')
        resp = self.client.post('/api/auth/login/', {'password': 'Test-Pass-9271'}, format='json')
        self.assertEqual(resp.status_code, 400)


@override_settings(DEBUG=True)
class SessionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('sessionuser')
        self.client = APIClient()
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
        resp = self.client.post('/api/auth/login/', {'email': 'sessionuser@test.local', 'password': 'Test-Pass-9271', 'device_id': 'dev-s'}, format='json')
        self.client.post('/api/auth/otp/', {'challenge': resp.data['challenge'], 'code': resp.data['dev_code'], 'device_id': 'dev-s'}, format='json')
        self.client.credentials(HTTP_X_CSRF_TOKEN=self.client.cookies['exposing_csrf'].value)

    def test_refresh_rotates_and_old_token_dies(self):
        old = self.client.cookies['exposing_refresh'].value
        resp = self.client.post('/api/auth/refresh/')
        self.assertEqual(resp.status_code, 200)
        new = self.client.cookies['exposing_refresh'].value
        self.assertNotEqual(old, new)
        self.client.cookies['exposing_refresh'] = old
        resp = self.client.post('/api/auth/refresh/')
        self.assertEqual(resp.status_code, 401)

    def test_logout_revokes_session_and_clears_cookies(self):
        refresh = self.client.cookies['exposing_refresh'].value
        resp = self.client.post('/api/auth/logout/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        self.client.cookies['exposing_refresh'] = refresh
        self.assertEqual(self.client.post('/api/auth/refresh/').status_code, 401)
        self.assertTrue(RefreshSession.objects.filter(user=self.user, revoked_at__isnull=False).exists())

    def test_access_cookie_is_httponly_and_refresh_scoped(self):
        access = self.client.cookies['exposing_access']
        refresh = self.client.cookies['exposing_refresh']
        self.assertTrue(access['httponly'])
        self.assertTrue(refresh['httponly'])
        self.assertEqual(refresh['path'], '/api/auth')

    def test_google_demo_flow_completes_signup(self):
        client = APIClient()
        client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
        resp = client.post('/api/auth/google/', {'demo': {'email': 'g@test.local', 'name': 'G User', 'sub': 'gsub1'}, 'device_id': 'dev-g'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['needs_signup'])
        self.assertEqual(resp.data['prefill']['name'], 'G User')
        resp = client.post('/api/auth/signup/', signup_payload('guser', email='g@test.local', google={'sub': 'gsub1'}), format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertNotIn('challenge', resp.data)
        user = User.objects.get(username='guser')
        self.assertTrue(user.email_verified)
        self.assertEqual(user.provider, 'google')
        resp = client.post('/api/auth/google/', {'demo': {'email': 'g@test.local', 'name': 'G User', 'sub': 'gsub1'}, 'device_id': 'dev-g'}, format='json')
        self.assertIn(resp.status_code, (200, 202))


@override_settings(DEBUG=True)
class EmailSignInTests(TestCase):
    """Sign up, leave, come back: the exact path that reported "my account is gone"."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())

    def join(self, username):
        """Create the account and confirm the address, which is what makes a member."""
        resp = self.client.post('/api/auth/signup/', signup_payload(username), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        verified = self.client.post('/api/auth/otp/', {
            'challenge': resp.data['challenge'], 'code': resp.data['dev_code'], 'device_id': f'dev-{username}',
        }, format='json')
        self.assertEqual(verified.status_code, 200, verified.data)
        self.client.credentials(HTTP_X_CSRF_TOKEN=self.client.cookies['exposing_csrf'].value)
        return verified

    def leave(self):
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)

    def test_signup_logout_login_round_trip(self):
        self.join('walkin')
        self.assertEqual(self.client.get('/api/auth/me/').data['username'], 'walkin')
        self.leave()
        resp = self.client.post('/api/auth/login/', {
            'email': 'walkin@test.local', 'password': 'Test-Pass-9271', 'device_id': 'dev-walkin',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(User.objects.filter(username='walkin', email='walkin@test.local').exists())
        self.client.credentials(HTTP_X_CSRF_TOKEN=self.client.cookies['exposing_csrf'].value)
        self.assertEqual(self.client.get('/api/auth/me/').data['username'], 'walkin')

    def test_the_address_opens_the_account_however_it_is_typed(self):
        # Signup trims, the browser may not, and the row is stored lowercase whatever
        # happened to it: ' X@Y.com ' and 'x@y.com' have to be one person.
        resp = self.client.post('/api/auth/signup/',
                                signup_payload('padded', email=' Padded@Test.Local '), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.client.post('/api/auth/otp/', {
            'challenge': resp.data['challenge'], 'code': resp.data['dev_code'], 'device_id': 'dev-padded',
        }, format='json')
        self.assertEqual(User.objects.get(username='padded').email, 'padded@test.local')
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
        resp = self.client.post('/api/auth/login/', {
            'email': ' PADDED@test.local ', 'password': 'Test-Pass-9271', 'device_id': 'dev-padded',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_the_password_needs_no_other_field_to_be_the_right_one(self):
        self.join('hashing')
        self.leave()
        wrong = self.client.post('/api/auth/login/', {
            'email': 'hashing@test.local', 'password': 'Test-Pass-927', 'device_id': 'dev-hashing',
        }, format='json')
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(wrong.data['attempts_left'], 2)
        # The same box, the same email, one character apart: hashing and checking are
        # symmetric, so the only thing that changed is the password.
        right = self.client.post('/api/auth/login/', {
            'email': 'hashing@test.local', 'password': 'Test-Pass-9271', 'device_id': 'dev-hashing',
        }, format='json')
        self.assertEqual(right.status_code, 200, right.data)


@override_settings(DEBUG=True)
class AccountSurvivesARestartTests(TransactionTestCase):
    """A deploy hands the app a new process over the same database.

    ``TestCase`` keeps every test inside a transaction that is rolled back, which is
    the opposite of what the report needs proved: that the signup was committed.
    This one really closes the connection and comes back through the front door.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())

    def test_account_still_exists_after_the_process_reconnects(self):
        resp = self.client.post('/api/auth/signup/', signup_payload('keeper'), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.client.post('/api/auth/otp/', {
            'challenge': resp.data['challenge'], 'code': resp.data['dev_code'], 'device_id': 'dev-keeper',
        }, format='json')
        connections.close_all()
        user = User.objects.filter(email='keeper@test.local').first()
        self.assertIsNotNone(user, 'the account did not outlive the request that made it')
        self.assertTrue(user.check_password('Test-Pass-9271'))
        self.assertTrue(hasattr(user, 'profile'))
        self.assertTrue(hasattr(user, 'wallet'))
        client = APIClient()
        client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())
        resp = client.post('/api/auth/login/', {
            'email': 'keeper@test.local', 'password': 'Test-Pass-9271', 'device_id': 'dev-keeper',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)


class PurgeSparesRealAccountsTests(TransactionTestCase):
    """The seeder is a deploy step, so its delete needs a rule instead of a scope."""

    def setUp(self):
        self.member = make_user('member')
        self.cast = make_user('cast', seeded=True)

    def test_purge_deletes_only_accounts_the_seeder_owns(self):
        Command().purge()
        self.assertTrue(User.objects.filter(username='member').exists())
        self.assertFalse(User.objects.filter(username='cast').exists())
        # A member nobody deleted keeps the address they signed up with.
        self.assertEqual(User.objects.get(username='member').email, 'member@test.local')


class GoogleDemoNeedsDebugTests(TestCase):
    """The demo branch believes whatever identity the client claims, so it must
    never be reachable on a server that is not explicitly in DEBUG."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.credentials(HTTP_X_FORWARDED_FOR=fresh_ip())

    def test_demo_identity_is_refused_when_debug_is_off(self):
        resp = self.client.post('/api/auth/google/', {'demo': {'email': 'x@test.local', 'name': 'X', 'sub': 'x1'}}, format='json')
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(User.objects.filter(username='x').exists())


class SecurityTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('secuser')

    def test_security_headers_present(self):
        resp = auth_client(self.user).get('/api/auth/me/')
        self.assertEqual(resp['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(resp['X-Frame-Options'], 'DENY')
        self.assertIn('frame-ancestors', resp['Content-Security-Policy'])
        self.assertEqual(resp['Referrer-Policy'], 'strict-origin-when-cross-origin')

    def test_csrf_double_submit_enforced_on_writes(self):
        client = auth_client(self.user)
        resp = client.post('/api/posts/', {'text': 'hi'}, format='json')
        self.assertEqual(resp.status_code, 201)
        client.credentials(HTTP_X_CSRF_TOKEN='mismatched')
        resp = client.post('/api/posts/', {'text': 'hi'}, format='json')
        self.assertEqual(resp.status_code, 403)
        client2 = APIClient()
        client2.cookies['exposing_access'] = client.cookies['exposing_access'].value
        resp = client2.post('/api/posts/', {'text': 'hi'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_write_rejected(self):
        resp = APIClient().post('/api/posts/', {'text': 'hi'}, format='json')
        self.assertIn(resp.status_code, (401, 403))