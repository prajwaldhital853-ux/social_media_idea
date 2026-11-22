import itertools
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

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
            '/api/auth/login/', {'username': 'lockme', 'password': password, 'device_id': device}, format='json',
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

    def test_unlock_request_accepts_username(self):
        # Sign-in takes either handle, so the unlock form must not demand the email.
        resp = self.client.post('/api/auth/unlock/', {'email': self.user.username}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('challenge', resp.data)

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
        resp = self.client.post('/api/auth/login/', {'username': 'sessionuser', 'password': 'Test-Pass-9271', 'device_id': 'dev-s'}, format='json')
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