"""Live check: every self-service setting round-trips through the API."""
import http.cookiejar
import json
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

    def patch(self, path, body):
        return self.call('PATCH', path, body)


def signup(tag, n):
    c = Client(f'10.99.{int(RUN) % 250}.{n}')
    s, b = c.post('/auth/signup/', {
        'username': f'{tag}{RUN}', 'email': f'{tag}{RUN}@smoke.test', 'password': 'Smoke-Pass-9271',
        'name': tag.title(), 'dob': '1995-05-05', 'country': 'Nepal', 'city': 'Kathmandu',
        'device_id': f'dev-{tag}{RUN}',
    })
    assert s == 201, (s, b)
    s, b = c.post('/auth/otp/', {'challenge': b['challenge'], 'code': b['dev_code'], 'device_id': f'dev-{tag}{RUN}'})
    assert s == 200, (s, b)
    return c, f'{tag}{RUN}'


owner, owner_name = signup('own', 1)
peer, peer_name = signup('peer', 2)

# Defaults: a fresh account is public, and email alerts are on.
s, session = owner.get('/auth/me/')
check('new account starts public', s == 200 and session.get('private') is False, f'{s} {session}')
check('new account gets follower email by default', session.get('notifyEmail') is True, str(session))

# --- each switch writes, and the next read agrees ---
for field, value in [('is_private', True), ('notify_email', False), ('two_step', False)]:
    s, row = owner.patch(f'/profiles/{owner_name}/', {field: value})
    check(f'patch {field}={value}', s == 200 and row.get(field) is value, f'{s} {row}')

s, session = owner.get('/auth/me/')
check('session reports the new settings',
      session.get('private') is True and session.get('notifyEmail') is False and session.get('twoStep') is False,
      str(session))
s, synced = owner.get('/sync/')
me = synced.get('me', {})
check('sync reports the new settings',
      me.get('private') is True and me.get('notifyEmail') is False and me.get('twoStep') is False, str(me)[:200])

# --- the private flag has teeth ---
s, post = owner.post('/posts/', {'text': 'behind the private door', 'audience': 'public'})
assert s == 201, (s, post)
s, feed = peer.get('/feed/?size=50')
check('private author hidden from a stranger feed',
      all(r['id'] != post['id'] for r in feed['results']), str(feed)[:200])
s, profile = peer.get(f'/profiles/{owner_name}/')
check('private profile locks a stranger out',
      s == 200 and (profile.get('locked') is True or profile.get('is_private') is True), str(profile)[:250])
s, follow = peer.post('/follows/', {'username': owner_name})
check('following a private account requests', s == 201 and follow.get('status') == 'pending', f'{s} {follow}')
s, queue = owner.get('/follows/requests/')
row = next((r for r in queue.get('results', []) if r['username'] == peer_name), None)
check('request shows in the owner queue', row is not None, str(queue)[:200])
s, accepted = owner.post(f"/follows/requests/{row['request_id']}/accept/", {}) if row else (0, {})
check('owner can approve the request', s == 200 and accepted.get('status') == 'accepted', f'{s} {accepted}')
s, feed2 = peer.get('/feed/?size=50')
check('approved follower sees the post', any(r['id'] == post['id'] for r in feed2['results']), str(feed2)[:200])

# --- going back to public is one switch away ---
s, row = owner.patch(f'/profiles/{owner_name}/', {'is_private': False})
check('account can turn public again', s == 200 and row.get('is_private') is False, f'{s} {row}')

print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
if FAIL:
    print('FAILED: ' + ', '.join(FAIL))
