"""Live end-to-end smoke test against http://127.0.0.1:8001 (run with the venv python)."""
import http.cookiejar
import json
import sys
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

    def call(self, method, path, body=None, headers=None, raw=False):
        url = path if path.startswith('http') else BASE + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        req.add_header('X-Forwarded-For', self.ip)
        if method not in ('GET', 'HEAD') and self.csrf():
            req.add_header('X-CSRF-Token', self.csrf())
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            resp = self.opener.open(req, timeout=30)
            payload = resp.read()
            status = resp.status
            hdrs = dict(resp.headers)
        except urllib.error.HTTPError as e:
            payload = e.read()
            status = e.code
            hdrs = dict(e.headers)
        if raw:
            return status, payload, hdrs
        try:
            return status, json.loads(payload or b'{}'), hdrs
        except json.JSONDecodeError:
            return status, {'raw': payload[:200].decode(errors='replace')}, hdrs

    def get(self, path, **kw):
        return self.call('GET', path, **kw)

    def post(self, path, body=None, **kw):
        return self.call('POST', path, body if body is not None else {}, **kw)


def signup(client, username, dob='1998-04-12', country='Nepal', city='Kathmandu'):
    s, b, _ = client.post('/auth/signup/', {
        'username': username, 'email': f'{username}@smoke.test', 'password': 'Smoke-Pass-9271',
        'name': username.title(), 'dob': dob, 'country': country, 'city': city, 'device_id': f'dev-{username}',
    })
    assert s == 201, (s, b)
    s2, b2, _ = client.post('/auth/otp/', {'challenge': b['challenge'], 'code': b['dev_code'], 'device_id': f'dev-{username}'})
    assert s2 == 200, (s2, b2)
    return b


OCT = int(RUN) % 250
alice = Client(f'10.77.{OCT}.1')
bob = Client(f'10.77.{OCT}.2')
carol = Client(f'10.77.{OCT}.3')
dave = Client(f'10.77.{OCT}.4')
staff = Client(f'10.77.{OCT}.5')

# --- auth: signup + verify + me + headers ---
a = signup(alice, f'alice{RUN}')
s, b, h = alice.get('/auth/me/')
check('signup+otp+me', s == 200 and b['username'] == f'alice{RUN}', str(b))
check('security headers', h.get('X-Content-Type-Options') == 'nosniff' and 'frame-ancestors' in h.get('Content-Security-Policy', ''), str(h))
check('access cookie HttpOnly', any(c.name == 'exposing_access' and c.has_nonstandard_attr('HttpOnly') for c in alice.jar))

signup(bob, f'bob{RUN}')
signup(carol, f'carol{RUN}', dob='1950-01-01', country='India', city='Delhi')

# --- csrf enforcement ---
s, b, _ = alice.call('POST', '/posts/', {'text': 'no csrf'}, headers={'X-CSRF-Token': 'wrong'})
check('CSRF rejected on write', s == 403, f'{s} {b}')

# --- posts + feed keyset ---
s, post, _ = alice.post('/posts/', {'text': 'Smoke anchor post', 'audience': 'public', 'category': 'Outdoors', 'media': [{'kind': 'image', 'url': 'https://picsum.photos/seed/smoke/900/600'}]})
check('create post with media', s == 201 and post['media'][0]['url'].endswith('/900/600'), str(post))
anchor_id = post['id']
for i in range(12):
    s, p, _ = alice.post('/posts/', {'text': f'filler {i}', 'audience': 'public'})
    assert s == 201
s, page1, _ = bob.get('/feed/')
rows1 = [r for r in page1['results'] if not r.get('promoted')]
check('feed page size 10', len(rows1) == 10, str(len(rows1)))
check('feed newest first', rows1[0]['text'] == 'filler 11', rows1[0]['text'])
check('feed has cursor', bool(page1.get('next_cursor')) and page1.get('has_more') is True)
s, page2, _ = bob.get('/feed/?cursor=' + page1['next_cursor'])
rows2 = page2['results']
ids1 = {r['id'] for r in rows1}
check('keyset page 2 no overlap', not ids1.intersection({r['id'] for r in rows2}) and len(rows2) >= 3, str(len(rows2)))
s, mid, _ = alice.post('/posts/', {'text': 'inserted between pages', 'audience': 'public'})
s, page2b, _ = bob.get('/feed/?cursor=' + page1['next_cursor'])
check('keyset stable under inserts', [r['id'] for r in page2b['results']] == [r['id'] for r in rows2])

# --- audience visibility ---
s, secret, _ = alice.post('/posts/', {'text': 'followers only secret', 'audience': 'followers'})
s, feedb, _ = bob.get('/feed/?size=50')
check('followers-only hidden from stranger', all(r['id'] != secret['id'] for r in feedb['results']))

# --- reactions + atomic counters ---
s, r1, _ = bob.post('/reactions/', {'target_type': 'post', 'target_id': str(anchor_id), 'kind': 'like'})
check('reaction created', s == 201, str(r1))
s, r2, _ = bob.post('/reactions/', {'target_type': 'post', 'target_id': str(anchor_id), 'kind': 'love'})
check('reaction switch not duplicate', s in (200, 201) and r2['id'] == r1['id'], f'{s} {r2}')
s, p, _ = bob.get(f'/posts/{anchor_id}/')
check('like_count == 1 after switch', p['like_count'] == 1, str(p['like_count']))
s, _, _ = bob.call('DELETE', '/reactions/toggle/', {'target_type': 'post', 'target_id': str(anchor_id)})
s, p, _ = bob.get(f'/posts/{anchor_id}/')
check('toggle off decrements', s == 200 and p['like_count'] == 0, f'{s} {p["like_count"]}')

# --- comments + counters + replies ---
s, c1, _ = bob.post('/comments/', {'post': anchor_id, 'text': 'Nice shot'})
check('comment created', s == 201, str(c1))
s, c2, _ = alice.post('/comments/', {'post': anchor_id, 'text': 'Thanks!', 'parent': c1['id']})
check('reply created', s == 201 and c2['parent'] == c1['id'])
s, p, _ = bob.get(f'/posts/{anchor_id}/')
check('comment_count == 2', p['comment_count'] == 2, str(p['comment_count']))
s, _, _ = bob.call('DELETE', f'/comments/{c1["id"]}/')
s, p, _ = bob.get(f'/posts/{anchor_id}/')
check('delete parent removes replies from count', s in (200, 204) and p['comment_count'] == 0, f'{s} {p["comment_count"]}')

# --- follows: public, private, requests, mutuals ---
s, b, _ = bob.post('/follows/', {'username': f'alice{RUN}'})
check('public follow accepted', s in (200, 201) and b.get('status') == 'accepted', str(b))
s, b, _ = alice.post('/follows/', {'username': f'bob{RUN}'})
check('follow back', s in (200, 201))
s, b, _ = alice.get('/follows/mutuals/')
check('mutuals lists bob', any(u.get('username') == f'bob{RUN}' for u in b['results']), str(b)[:200])
s, b, _ = alice.get(f'/users/alice{RUN}/followers/')
check('followers page includes bob', any(u.get('username') == f'bob{RUN}' for u in b['results']), str(b)[:200])
s, b, _ = bob.get(f'/profiles/alice{RUN}/')
check('profile counts', b.get('followers_count', b.get('followers')) is not None, str(b)[:200])

s, b, _ = bob.call('PATCH', f'/profiles/bob{RUN}/', {'is_private': True, 'bio': 'Private smoke bio', 'dob': '1997-02-03', 'country': 'Nepal', 'city': 'Pokhara', 'cover_url': 'https://picsum.photos/seed/cover/1200/400'})
check('profile PATCH private+bio', s == 200, str(b))
check('profile PATCH dob+city persisted', s == 200 and b.get('dob') == '1997-02-03' and b.get('city') == 'Pokhara', str(b))
s, _, _ = carol.call('DELETE', f'/follows/bob{RUN}/')
s, b, _ = carol.post('/follows/', {'username': f'bob{RUN}'})
check('private follow pending', b.get('status') == 'pending', str(b))
s, locked, _ = carol.get(f'/profiles/bob{RUN}/')
check('private profile locked for stranger', locked.get('locked') is True or 'posts' not in locked, str(locked)[:150])
s, reqs, _ = bob.get('/follows/requests/')
req = next((r for r in reqs['results'] if r.get('username') == f'carol{RUN}' or r.get('follower_username') == f'carol{RUN}'), None)
check('request listed', req is not None, str(reqs)[:250])
if req:
    s, b, _ = bob.post(f'/follows/requests/{req["request_id"]}/accept/')
    check('accept request', s == 200, str(b))
    s, st, _ = carol.get(f'/follows/state/bob{RUN}/')
    check('state following after accept', st.get('state') in ('following', 'accepted') or st.get('following') is True, str(st))

# --- messages ---
s, b, _ = alice.post(f'/messages/bob{RUN}/', {'text': 'Ridge hike at six?'})
check('send message', s in (200, 201), str(b))
s, inbox, _ = bob.get('/messages/inbox/')
row = next((r for r in inbox['results'] if r.get('user', {}).get('username') == f'alice{RUN}'), None)
check('inbox shows thread + unread', row is not None and row.get('unread', 0) >= 1, str(inbox)[:250])
s, thread, _ = bob.get(f'/messages/alice{RUN}/')
check('thread ascending', thread['results'] and thread['results'][-1]['text'] == 'Ridge hike at six?', str(thread)[:200])
s, _, _ = bob.post(f'/messages/alice{RUN}/read/')
s, inbox, _ = bob.get('/messages/inbox/')
row = next((r for r in inbox['results'] if r.get('user', {}).get('username') == f'alice{RUN}'), None)
check('mark read zeroes unread', row is not None and row.get('unread', 0) == 0, str(row))

# --- notifications ---
s, b, _ = alice.get('/notifications/unread/')
check('notifications unread > 0', s == 200 and b.get('unread', b.get('count', 0)) > 0, str(b))
s, notes, _ = alice.get('/notifications/')
check('notifications list', s == 200 and len(notes['results']) > 0)
s, _, _ = alice.post('/notifications/read/', {'all': True})
s, b, _ = alice.get('/notifications/unread/')
check('mark all read', b.get('unread', b.get('count', 1)) == 0, str(b))

# --- marketplace ---
s, listing, _ = alice.post('/marketplace/', {'title': 'Smoke kayak', 'description': 'Fast boat', 'price': 15000, 'category': 'Outdoors', 'condition': 'Used - good', 'location': 'Pokhara', 'images': [{'url': 'https://picsum.photos/seed/kayak/900/600'}]})
check('listing created', s == 201 and listing['images'], str(listing)[:200])
lid = listing['id']
s, b, _ = bob.get('/marketplace/?category=Outdoors&min=10000&max=20000&q=kayak')
check('listing filters', any(r['id'] == lid for r in b['results']), str(b)[:200])
s, b, _ = bob.get('/marketplace/categories/')
check('categories endpoint', s == 200, str(b)[:120])
s, _, _ = bob.post('/saved/listings/', {'listing': lid})
s, b, _ = bob.get('/saved/listings/')
check('save listing', any(r['id'] == lid or r.get('listing', {}).get('id') == lid for r in b['results']), str(b)[:200])
s, _, _ = bob.call('DELETE', f'/saved/listings/{lid}/')
s, b, _ = bob.get('/saved/listings/')
check('unsave listing', all(r['id'] != lid and r.get('listing', {}).get('id') != lid for r in b['results']))
s, _, _ = bob.post('/saved/posts/', {'post': anchor_id})
s, b, _ = bob.get('/saved/posts/')
check('save post', any(r['id'] == anchor_id or r.get('post', {}).get('id') == anchor_id for r in b['results']), str(b)[:200])
s, b, _ = bob.post(f'/marketplace/{lid}/sold/')
check('non-owner cannot mark sold', s in (403, 404), str(s))
s, b, _ = alice.post(f'/marketplace/{lid}/sold/')
check('owner marks sold', s == 200, str(b))
s, b, _ = alice.post(f'/marketplace/{lid}/relist/')
check('owner relists', s == 200, str(b))

# --- wallet: coin request -> staff approve -> ledger ---
s, b, _ = alice.post('/wallet/requests/', {'coins': 500, 'amount': 500, 'method': 'esewa', 'reference': f'SMOKE-{RUN}'})
check('coin request created', s == 201, str(b))
req_id = b['id']
s, b, _ = alice.get('/wallet/')
balance_before = b['balance']
s, b, _ = staff.post('/auth/login/', {'email': 'sita@demo.test', 'password': 'exposing-demo-1', 'device_id': f'dev-staff-{RUN}'})
if s == 202:
    s, b, _ = staff.post('/auth/otp/', {'challenge': b['challenge'], 'code': b['dev_code'], 'device_id': f'dev-staff-{RUN}'})
check('staff login', s == 200, str(b))
s, b, _ = staff.get('/wallet/requests/list/')
check('staff sees all requests', any(r['id'] == req_id for r in b['results']), str(b)[:200])
s, b, _ = staff.post(f'/wallet/requests/{req_id}/approve/')
check('staff approves coins', s == 200, str(b))
s, b, _ = alice.get('/wallet/')
check('balance credited', b['balance'] == balance_before + 500, f'{balance_before} -> {b["balance"]}')
check('ledger append-only rows', len(b['results']) >= 1, str(b)[:200])
s, b, _ = alice.post('/wallet/requests/', {'coins': 10, 'amount': 10, 'method': 'esewa', 'reference': 'x'})
s, b2, _ = bob.post(f'/wallet/requests/{b["id"]}/approve/')
check('non-staff cannot approve', b2 and s in (403, 404), str(s))

# --- promotions: targeting + interest + label ---
s, promo, _ = alice.post('/promotions/', {'target_type': 'post', 'target_id': str(anchor_id), 'category': 'Outdoors', 'age_min': 18, 'age_max': 40, 'country': 'Nepal', 'budget': 100})
check('promotion created + debited', s == 201, str(promo))
s, b, _ = alice.get('/wallet/')
check('budget debited', b['balance'] == balance_before + 500 - 100, str(b['balance']))
s, b, _ = alice.post('/promotions/', {'target_type': 'post', 'target_id': str(anchor_id), 'budget': 999999})
check('overdraft rejected', s == 400, str(b))
s, feedb, _ = bob.get('/feed/')
lead = feedb['results'][0]
check('interest ranking beats seeded travel promo', lead.get('promoted') is True and lead['id'] == anchor_id, str([r.get('id') for r in feedb['results'][:3]]))
check('promoted label + promo_id', lead.get('promo_id') == promo['id'])
ordinary = [r for r in feedb['results'] if not r.get('promoted')]
check('ordinary rows unranked newest-first', ordinary[0]['text'] == 'followers only secret', ordinary[0]['text'])
s, feedc, _ = carol.get('/feed/')
check('non-matching audience never sees promo', all(r['id'] != anchor_id or not r.get('promoted') for r in feedc['results']) and all(not r.get('promoted') for r in feedc['results']))
s, b, _ = alice.post(f'/promotions/{promo["id"]}/pause/')
check('pause promotion', s == 200, str(b))
s, feedb, _ = bob.get('/feed/')
check('paused promo not served', all(not (r.get('promoted') and r['id'] == anchor_id) for r in feedb['results']))
s, b, _ = alice.post(f'/promotions/{promo["id"]}/resume/')
check('resume promotion', s == 200)

# --- moderation ---
s, rep, _ = carol.post('/moderation/reports/', {'target_type': 'post', 'target_id': str(anchor_id), 'reason': 'spam', 'details': 'smoke report'})
check('report created', s == 201, str(rep))
s, b, _ = bob.get('/moderation/reports/')
check('reports staff-only', s in (403, 404), str(s))
s, b, _ = staff.get('/moderation/reports/')
check('staff lists reports', any(r['id'] == rep['id'] for r in b['results']))
s, b, _ = staff.post(f'/moderation/reports/{rep["id"]}/dismiss/')
check('dismiss report', s == 200, str(b))
signup(dave, f'dave{RUN}')
s, b, _ = staff.post(f'/moderation/users/dave{RUN}/suspend/', {'days': 1, 'reason': 'smoke suspend'})
check('suspend user', s == 200, str(b))
s, b, _ = dave.post('/auth/login/', {'email': f'dave{RUN}@smoke.test', 'password': 'Smoke-Pass-9271', 'device_id': f'dev-dave{RUN}'})
check('suspended login blocked 403', s == 403, str(b))
s, b, _ = staff.post(f'/moderation/users/dave{RUN}/reinstate/')
check('reinstate user', s == 200, str(b))
s, b, _ = staff.get('/moderation/audit/')
check('audit log records actions', len(b['results']) >= 2, str(b)[:150])

# --- lockout + unlock (dedicated user so login rate limits stay clean) ---
erin = Client(f'10.77.{OCT}.10')
signup(erin, f'erin{RUN}')
for i in range(3):
    s, b, _ = erin.post('/auth/login/', {'email': f'erin{RUN}@smoke.test', 'password': 'wrong-password', 'device_id': f'dev-erin{RUN}'})
check('3rd wrong password locks 423', s == 423 and b.get('locked'), f'{s} {b}')
challenge, code = b.get('challenge'), b.get('dev_code')
s, b, _ = erin.post('/auth/login/', {'email': f'erin{RUN}@smoke.test', 'password': 'Smoke-Pass-9271', 'device_id': f'dev-erin{RUN}'})
check('locked even with right password', s == 423, str(s))
s, b, _ = erin.post('/auth/unlock/confirm/', {'challenge': challenge, 'code': code})
check('unlock via OTP', s == 200, str(b))
s, b, _ = erin.post('/auth/login/', {'email': f'erin{RUN}@smoke.test', 'password': 'Smoke-Pass-9271', 'device_id': f'dev-erin{RUN}'})
if s == 202:
    s, b, _ = erin.post('/auth/otp/', {'challenge': b['challenge'], 'code': b['dev_code'], 'device_id': f'dev-erin{RUN}'})
check('login after unlock', s == 200, str(b))

# --- new device challenge + trusted device ---
dave2 = Client(f'10.77.{OCT}.6')
s, b, _ = dave2.post('/auth/login/', {'email': f'erin{RUN}@smoke.test', 'password': 'Smoke-Pass-9271', 'device_id': 'brand-new-device'})
check('new device 202 challenge', s == 202 and b.get('new_device'), f'{s} {b}')
ch2, code2 = b.get('challenge'), b.get('dev_code')
s, b, _ = dave2.post('/auth/otp/', {'challenge': ch2, 'code': '000000' if code2 != '000000' else '111111'})
check('wrong OTP rejected', s == 400 and 'attempts_left' in b, str(b))
s, b, _ = dave2.post('/auth/otp/', {'challenge': ch2, 'code': code2, 'device_id': 'brand-new-device'})
check('OTP verify logs in', s == 200, str(b))
s, b, _ = dave2.post('/auth/login/', {'email': f'erin{RUN}@smoke.test', 'password': 'Smoke-Pass-9271', 'device_id': 'brand-new-device'})
check('trusted device skips OTP', s == 200, f'{s} {b}')

# --- refresh rotation + logout revocation ---
s, b, _ = dave2.post('/auth/refresh/')
check('refresh rotates', s == 200 and b.get('refreshed'), str(b))
old_refresh = next((c.value for c in dave2.jar if c.name == 'exposing_refresh'), '')
s, b, _ = dave2.post('/auth/refresh/')
check('second refresh works', s == 200)
s, b, _ = dave2.post('/auth/logout/')
check('logout clears', s == 200)
s, b, _ = dave2.get('/auth/me/')
check('me after logout 401', s == 401, str(s))

# --- rate limits (asserted only while the server enforces them) ---
s, meta, _ = Client(f'10.77.{OCT}.7').get('/meta/')
if not meta.get('rateLimits', True):
    print('skip  rate limits (this server runs with EXPOSING_RATE_LIMITS=0; covered by the Django test suite)')
else:
    rl = Client(f'10.77.{OCT}.7')
    codes = []
    for i in range(5):
        s, b, _ = rl.post('/auth/signup/', {'username': f'rl{i}{RUN}', 'email': f'rl{i}{RUN}@smoke.test', 'password': 'Smoke-Pass-9271', 'dob': '1995-01-01', 'country': 'Nepal'})
        codes.append(s)
    check('signup rate limit 3/h then 429', codes == [201, 201, 201, 429, 429], str(codes))
    s, b, _ = rl.post('/auth/signup/', {'username': f'rlx{RUN}', 'email': f'rlx{RUN}@smoke.test', 'password': 'Smoke-Pass-9271', 'dob': '1995-01-01', 'country': 'Nepal'})
    check('4th signup throttled', s == 429, str(s))
    lr = Client(f'10.77.{OCT}.8')
    logins = [lr.post('/auth/login/', {'email': 'nobody@smoke.test', 'password': 'x'}) for _ in range(11)]
    codes = [s for s, _b, _h in logins]
    check('login IP limit 10/min then 429', codes[:10] == [401] * 10 and codes[10] == 429, str(codes))
    check('the throttle refuses in human words', 'Too many attempts' in (logins[10][1].get('detail') or ''), str(logins[10][1])[:160])

# --- google demo flow ---
g = Client(f'10.77.{OCT}.9')
s, b, _ = g.post('/auth/google/', {'demo': {'email': f'g{RUN}@smoke.test', 'name': 'Google Smoke', 'sub': f'gsub{RUN}'}, 'device_id': f'dev-g{RUN}'})
check('google new user needs signup', s == 200 and b.get('needs_signup') and b['prefill']['name'] == 'Google Smoke', str(b))
s, b, _ = g.post('/auth/signup/', {'username': f'guser{RUN}', 'email': f'g{RUN}@smoke.test', 'name': 'Google Smoke', 'dob': '1996-06-01', 'country': 'Nepal', 'google': {'sub': f'gsub{RUN}'}, 'device_id': f'dev-g{RUN}'})
check('google signup completes without OTP', s == 201 and 'challenge' not in b, str(b))
s, b, _ = g.get('/auth/me/')
check('google user verified', s == 200 and b['provider'] == 'google', str(b))

print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
if FAIL:
    print('FAILED:', *FAIL, sep='\n  - ')
    sys.exit(1)