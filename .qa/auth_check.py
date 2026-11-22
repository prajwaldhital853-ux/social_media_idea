"""Live check: the wrong-password cooloff, and what a throttled login answers.

Run alone, with the API on 127.0.0.1:8001:
    cd D:/social_medial/backend && .venv/Scripts/python.exe ../.qa/auth_check.py
"""
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.request

BASE = 'http://127.0.0.1:8001/api'
RUN = str(int(time.time()))[-6:]
PASS, FAIL = [], []


def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(('ok  ' if cond else 'FAIL') + f' {name}' + (f'  [{extra}]' if extra and not cond else ''))


class Client:
    def __init__(self, ip):
        self.ip = ip
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def csrf(self):
        for c in self.jar:
            if c.name == 'exposing_csrf':
                return c.value
        return ''

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        req.add_header('X-Forwarded-For', self.ip)
        if method not in ('GET', 'HEAD'):
            req.add_header('X-CSRF-Token', self.csrf())
        try:
            resp = self.opener.open(req, timeout=30)
            payload, status = resp.read(), resp.status
        except urllib.error.HTTPError as e:
            payload, status = e.read(), e.code
        try:
            return status, json.loads(payload or b'{}')
        except json.JSONDecodeError:
            return status, {'raw': payload[:200].decode(errors='replace')}

    def get(self, path):
        return self.call('GET', path)

    def post(self, path, body=None):
        return self.call('POST', path, body if body is not None else {})


os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')
import sys  # noqa: E402

# The script sits in .qa, so Django's own package is only importable from here.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))
import django  # noqa: E402

django.setup()
from apps.accounts.models import EmailOTP, User  # noqa: E402

NAME = f'locky{RUN}'
PASSWORD = 'Smoke-Pass-9271'
DEVICE = f'dev-locky{RUN}'

# ---- a member of our own making, so no QA run can trip over this ----
signup_ip = Client(f'10.88.{int(RUN) % 250}.71')
s, b = signup_ip.post('/auth/signup/', {
    'username': NAME, 'email': f'{NAME}@smoke.test', 'password': PASSWORD,
    'name': 'Locky', 'dob': '1995-05-05', 'country': 'Nepal', 'city': 'Kathmandu',
    'device_id': DEVICE,
})
assert s == 201, (s, b)
s, b = signup_ip.post('/auth/otp/', {'challenge': b['challenge'], 'code': b['dev_code'], 'device_id': DEVICE})
assert s == 200, (s, b)

guesser = Client(f'10.88.{int(RUN) % 250}.72')
attempts = [guesser.post('/auth/login/', {'username': NAME, 'password': 'nope-a', 'device_id': 'dev-guess'})
            for _ in range(2)]
check('the first two wrong passwords count down', [a[0] for a in attempts] == [401, 401]
      and [a[1].get('attempts_left') for a in attempts] == [2, 1], str([(a[0], a[1]) for a in attempts]))

s, locked = guesser.post('/auth/login/', {'username': NAME, 'password': 'nope-b', 'device_id': 'dev-guess'})
check('the third wrong password locks the account', s == 423 and locked.get('locked') is True, f'{s} {locked}')
check('the lock counts five minutes on the server clock', locked.get('retry_in') == 300, str(locked)[:200])
# The cooloff lifts by itself, so there is no rescue email to promise and none to send.
check('the lock promises no unlock code', 'challenge' not in locked, str(locked)[:200])
mail_before = EmailOTP.objects.filter(user__username=NAME).count()

s, right = guesser.post('/auth/login/', {'username': NAME, 'password': PASSWORD, 'device_id': 'dev-guess'})
check('the right password is still refused while the cooloff runs',
      s == 423 and right.get('locked') is True and 0 < right.get('retry_in', 0) < 300, f'{s} {right}')
s, _me = guesser.get('/auth/me/')
check('a refused login opens no session', s == 401, str(s))
check('the cooloff still sends no unlock email', EmailOTP.objects.filter(user__username=NAME).count() == mail_before,
      f'{mail_before} -> {EmailOTP.objects.filter(user__username=NAME).count()}')

# ---- ten tries a minute from one place, then a refusal a person can read ----
codes = [guesser.post('/auth/login/', {'username': NAME, 'password': 'nope-c', 'device_id': 'dev-guess'})[0]
         for _ in range(6)]
check('the tenth try in the minute is still answered by the lock', set(codes) == {423}, str(codes))
s, throttled = guesser.post('/auth/login/', {'username': NAME, 'password': PASSWORD, 'device_id': 'dev-guess'})
check('the eleventh try in the minute is throttled', s == 429, f'{s} {throttled}')
check('the throttle says what to do instead of quoting the framework',
      str(throttled.get('detail', '')).startswith('Too many attempts') and 'throttled' not in str(throttled),
      str(throttled)[:200])
check('the throttle hands the client the seconds to wait',
      isinstance(throttled.get('retry_in'), int) and throttled['retry_in'] > 0, str(throttled)[:200])

# ---- the clock runs out on its own, and then the owner is back in ----
from django.utils import timezone  # noqa: E402
from datetime import timedelta  # noqa: E402

User.objects.filter(username=NAME).update(locked_until=timezone.now() - timedelta(seconds=1))
owner = Client(f'10.88.{int(RUN) % 250}.73')
# Signed in by email: the guesser above spent that username's per-account counter,
# and the owner is a different reader of the same form, not the same attacker.
s, resumed = owner.post('/auth/login/', {'username': f'{NAME}@smoke.test', 'password': PASSWORD, 'device_id': DEVICE})
check('once the cooloff has passed the right password works again', s in (200, 202), f'{s} {resumed}')
if s == 202:
    s, resumed = owner.post('/auth/otp/', {
        'challenge': resumed['challenge'], 'code': resumed['dev_code'], 'device_id': DEVICE})
    check('the new-device code still completes the sign-in', s == 200, f'{s} {resumed}')
s, me = owner.get('/auth/me/')
check('the resumed sign-in opens a live session', s == 200 and me.get('username') == NAME, f'{s} {str(me)[:160]}')
fresh = User.objects.get(username=NAME)
check('the spent lock leaves no half-counted attempts', fresh.failed_attempts == 0 and fresh.locked_until is None,
      f'{fresh.failed_attempts} {fresh.locked_until}')

print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
if FAIL:
    raise SystemExit(1)
