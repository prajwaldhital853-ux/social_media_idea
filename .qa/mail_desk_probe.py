"""The mail desk: does the read-out describe reality, and does the test send tell the truth?

Three provider states are walked through the real URL: a backend that only logs,
the Resend backend with no key, and the Resend backend with a key that is not one.
The last two are what a misconfigured deployment looks like, and the seat has to be
told which of them it is holding. Everything is written inside one transaction that
is rolled back, so the probe leaves no seat and no audit row behind.
"""

import os

os.environ['DJANGO_SETTINGS_MODULE'] = 'exposing.settings'
os.environ['EMAIL_BACKEND'] = 'django.core.mail.backends.locmem.EmailBackend'
os.environ['DJANGO_ALLOWED_HOSTS'] = 'localhost,127.0.0.1,testserver'

import django  # noqa: E402

django.setup()

from django.core import mail as djmail  # noqa: E402
from django.db import transaction  # noqa: E402
from django.test import override_settings  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from apps.accounts.models import User  # noqa: E402
from apps.adminpanel import maildesk, totp  # noqa: E402
from apps.adminpanel.models import StaffAccount  # noqa: E402
from apps.adminpanel.tests_session import VERIFY_URL, carry  # noqa: E402
from apps.common import emails  # noqa: E402

DESK = '/api/admin/welcome/'
TEST_URL = '/api/admin/welcome/mail-test/'
LOGIN_URL = '/api/admin/session/login/'
RESEND = 'apps.common.email.EmailBackend'
INBOX = 'member.inbox@gmail.com'

side = transaction.atomic()
side.__enter__()

seat = User.objects.create_user(username='mailprobe-seat', email='probe.seat@gmail.com',
                                password='probe-pass-1', is_superuser=True, is_staff=True)
staff = StaffAccount.objects.create(user=seat, role=StaffAccount.Role.SUPERADMIN)
secret = staff.provision_secret()
staff.confirm_enrolment(['PROBE-CODE'])

client = APIClient()
started = client.post(LOGIN_URL, {'email': seat.email, 'password': 'probe-pass-1'}, format='json')
carry(client, started)
granted = client.post(VERIFY_URL, {'code': totp.totp(secret)}, format='json')
carry(client, granted)
print(f'sign-in -> login {started.status_code}, verify {granted.status_code}')

desk = client.get(DESK)
print(f'GET {DESK} -> {desk.status_code}')
if desk.status_code != 200:
    print(desk.data if hasattr(desk, 'data') else desk.content[:400])
    raise SystemExit(1)
print('mail block:', desk.json()['mail'])

djmail.outbox.clear()
answer = client.post(TEST_URL, {'to': INBOX}, format='json')
print(f'\nlocmem send -> {answer.status_code} {answer.json()["detail"][:130]}')
print('letters:', [f'{m.to[0]} | {m.subject}' for m in djmail.outbox])
print('html part:', 'yes' if djmail.outbox and djmail.outbox[0].alternatives else 'no')
print('logo attached:', bool(djmail.outbox and djmail.outbox[0].attachments))

bad = client.post(TEST_URL, {'to': 'not-an-address'}, format='json')
print(f'bad address -> {bad.status_code} {bad.json()["detail"][:90]}')

with override_settings(EMAIL_BACKEND=RESEND, RESEND_API_KEY=''):
    print(f'\nno key problem: {maildesk.status()["problem"][:130]}')
    out = client.post(TEST_URL, {'to': INBOX}, format='json')
    print(f'no key -> {out.status_code} {out.json()["detail"][:170]}')

with override_settings(EMAIL_BACKEND=RESEND, RESEND_API_KEY='re_not_a_real_key_at_all'):
    out = client.post(TEST_URL, {'to': INBOX}, format='json')
    print(f'\nwrong key -> {out.status_code} {out.json()["detail"][:230]}')

with override_settings(CELERY_TASK_ALWAYS_EAGER=False):
    print(f'\nqueue mode: {emails.mail_delivery_problem()[:170]}')

transaction.set_rollback(True)
side.__exit__(None, None, None)
print('\nrolled back: probe seat left =', User.objects.filter(username='mailprobe-seat').exists())
