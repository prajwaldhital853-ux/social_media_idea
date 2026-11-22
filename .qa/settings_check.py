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
outsider, outsider_name = signup('outsd', 3)
anon = Client('10.99.%d.9' % (int(RUN) % 250))

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

# --- nothing else reaches through the same door ---
pid = post['id']
s, _ = outsider.get(f'/posts/{pid}/')
check('stranger cannot open the post by id', s == 404, f'{s}')
s, thread = outsider.get(f'/comments/?post={pid}&top=1')
check('stranger cannot read the thread', s == 200 and thread.get('results') == [], f'{s} {str(thread)[:150]}')
s, thread = anon.get(f'/comments/?post={pid}&top=1')
check('a shared link reveals no comments', s == 200 and thread.get('results') == [], f'{s} {str(thread)[:150]}')
s, wrong = outsider.post('/comments/', {'post': pid, 'text': 'let me in'})
check('stranger cannot comment', s == 400, f'{s} {wrong}')
s, _ = outsider.post('/reactions/', {'target_type': 'post', 'target_id': str(pid), 'kind': 'like'})
check('stranger cannot react', s == 404, f'{s}')
s, names = outsider.get(f'/reactions/?target_type=post&target_id={pid}')
check('reaction list names nobody', s == 200 and names.get('results') == [], f'{s} {str(names)[:150]}')
s, _ = outsider.post('/saved/posts/', {'post': pid})
check('stranger cannot save it', s == 404, f'{s}')

# ...and the accepted follower still can, so the door is closed only to strangers.
s, comment = peer.post('/comments/', {'post': pid, 'text': 'hello from a follower'})
check('follower can comment', s == 201, f'{s} {comment}')
s, _ = peer.post('/reactions/', {'target_type': 'post', 'target_id': str(pid), 'kind': 'like'})
check('follower can react', s in (200, 201), f'{s}')
s, rows = owner.get(f'/comments/?post={pid}&top=1')
check('author reads their own thread', s == 200 and any(c['text'] == 'hello from a follower' for c in rows.get('results', [])),
      f'{s} {str(rows)[:200]}')
s, one = anon.get(f'/posts/{pid}/')
check('a shared link cannot fetch the post body', s == 404, f'{s}')

# --- a pending request is not a follower, anywhere ---
s, before = anon.get(f'/profiles/{owner_name}/')
s, _ = outsider.post('/follows/', {'username': owner_name})
s, during = anon.get(f'/profiles/{owner_name}/')
check('a pending request does not move the count',
      before.get('followers') == during.get('followers'), f'{before.get("followers")} -> {during.get("followers")}')
s, found = outsider.get(f'/users/?q={owner_name}')
card = next((c for c in found.get('results', []) if c['username'] == owner_name), None)
check('search card agrees with the profile count',
      card is not None and card.get('followers') == during.get('followers'), f'{card} vs {during.get("followers")}')

# --- and it buys no advertising ---
s, promo = owner.post('/promotions/', {'target_type': 'post', 'target_id': str(pid), 'budget': 0})
check('private account cannot promote', s == 400 and 'private' in str(promo).lower(), f'{s} {promo}')

# --- going back to public is one switch away ---
s, row = owner.patch(f'/profiles/{owner_name}/', {'is_private': False})
check('account can turn public again', s == 200 and row.get('is_private') is False, f'{s} {row}')
s, thread = outsider.get(f'/comments/?post={pid}&top=1')
check('one switch reopens the thread', s == 200 and thread.get('results'), f'{s} {str(thread)[:150]}')
s, promo = owner.post('/promotions/', {'target_type': 'post', 'target_id': str(pid), 'budget': 0})
check('the same promotion is allowed once public', s == 201, f'{s} {promo}')
if s == 201:
    owner.post(f"/promotions/{promo['id']}/end/", {})

print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
if FAIL:
    print('FAILED: ' + ', '.join(FAIL))
