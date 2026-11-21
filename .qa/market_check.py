"""Live check: marketplace CRUD + wallet requests against http://127.0.0.1:8001."""
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


seller = Client(f'10.88.{int(RUN) % 250}.1')
s, b = seller.post('/auth/signup/', {
    'username': f'shop{RUN}', 'email': f'shop{RUN}@smoke.test', 'password': 'Smoke-Pass-9271',
    'name': 'Shop Keeper', 'dob': '1996-02-02', 'country': 'Nepal', 'city': 'Kathmandu',
    'device_id': f'dev-shop{RUN}',
})
assert s == 201, (s, b)
s, b = seller.post('/auth/otp/', {'challenge': b['challenge'], 'code': b['dev_code'], 'device_id': f'dev-shop{RUN}'})
assert s == 200, (s, b)

# --- create ---
s, row = seller.post('/marketplace/', {
    'title': 'Bosco trekking boots', 'description': 'Used twice on the Annapurna circuit.',
    'price': 4200, 'category': 'Outdoors', 'location': 'Kathmandu', 'currency': 'NPR',
    'images': [{'url': 'https://picsum.photos/seed/boots-a/900/600'},
               {'url': 'https://picsum.photos/seed/boots-b/900/600'}],
})
check('listing create 201', s == 201, f'{s} {row}')
check('create keeps photo order', [i['url'] for i in row.get('images', [])] ==
      ['https://picsum.photos/seed/boots-a/900/600', 'https://picsum.photos/seed/boots-b/900/600'], str(row))
check('create stamps seller and status', row.get('seller_username') == f'shop{RUN}' and row.get('status') == 'active', str(row))
lid = row['id']

# --- create rejects more than four photos ---
s, over = seller.post('/marketplace/', {
    'title': 'Too many photos', 'price': 10, 'category': 'Other', 'location': 'Pokhara',
    'images': [{'url': f'https://picsum.photos/seed/x{i}/400/300'} for i in range(5)],
})
check('reject five photos', s == 400, f'{s} {over}')

# --- edit ---
s, edited = seller.patch(f'/marketplace/{lid}/', {
    'title': 'Bosco trekking boots (size 42)', 'description': 'Now with new laces.',
    'price': 3800, 'category': 'Outdoors', 'location': 'Lalitpur',
    'images': [{'url': 'https://picsum.photos/seed/boots-c/900/600'}],
})
check('listing patch 200', s == 200, f'{s} {edited}')
check('patch replaces photos', len(edited.get('images', [])) == 1
      and edited['images'][0]['url'].endswith('/boots-c/900/600'), str(edited))
s, again = seller.get(f'/marketplace/{lid}/')
check('patch persisted', again.get('title') == 'Bosco trekking boots (size 42)'
      and again.get('location') == 'Lalitpur' and len(again.get('images', [])) == 1, str(again))

# --- status transitions ---
s, sold = seller.post(f'/marketplace/{lid}/sold/', {})
check('mark sold persists', s == 200 and sold.get('status') == 'sold', f'{s} {sold}')
s, bad = seller.post(f'/marketplace/{lid}/sold/', {})
check('sold twice rejected', s == 400, f'{s} {bad}')
s, relit = seller.post(f'/marketplace/{lid}/relist/', {})
check('relist works', s == 200 and relit.get('status') == 'active', f'{s} {relit}')

# --- delete is a status, hidden from the market ---
s, gone = seller.post(f'/marketplace/{lid}/remove/', {})
check('remove works', s == 200 and gone.get('status') == 'removed', f'{s} {gone}')
s, page = seller.get('/marketplace/?mine=1')
mine_row = next((r for r in page['results'] if r['id'] == lid), None)
check('own page still answers for the seller', mine_row and mine_row['status'] == 'removed', str(page)[:200])
s, detail = seller.get(f'/marketplace/{lid}/')
check('removed still resolvable by id', s == 200 and detail.get('status') == 'removed', f'{s} {detail}')
s, relit2 = seller.post(f'/marketplace/{lid}/relist/', {})
check('removed cannot be relisted', s == 400, f'{s} {relit2}')

# --- someone else cannot touch it ---
buyer = Client(f'10.88.{int(RUN) % 250}.2')
s, b = buyer.post('/auth/signup/', {
    'username': f'buy{RUN}', 'email': f'buy{RUN}@smoke.test', 'password': 'Smoke-Pass-9271',
    'name': 'Buyer', 'dob': '1994-04-04', 'country': 'Nepal', 'city': 'Bhaktapur',
    'device_id': f'dev-buy{RUN}',
})
assert s == 201, (s, b)
s, b = buyer.post('/auth/otp/', {'challenge': b['challenge'], 'code': b['dev_code'], 'device_id': f'dev-buy{RUN}'})
assert s == 200, (s, b)
s, other = buyer.post('/marketplace/', {'title': 'Buyer own ad', 'price': 50, 'category': 'Other', 'location': 'Bhaktapur'})
check('buyer can create own ad', s == 201, f'{s} {other}')
s, live = seller.post('/marketplace/', {'title': 'Still on the shelf', 'price': 900,
                                        'category': 'Other', 'location': 'Kathmandu'})
assert s == 201, (s, live)
s, stolen = buyer.patch(f'/marketplace/{live["id"]}/', {'title': 'hijacked'})
check("cannot edit another's live listing", s == 403, f'{s} {stolen}')
s, hijack = buyer.post(f'/marketplace/{live["id"]}/sold/', {})
check("cannot change another's status", s == 404, f'{s} {hijack}')
s, public = buyer.get('/marketplace/')
check("removed hides from a stranger's market", all(r['id'] != lid for r in public['results']), str(public)[:200])
s, hunted = buyer.get('/marketplace/?status=removed')
check('strangers cannot pull a removed ad by filter',
      all(r['seller'] != row['seller'] for r in hunted['results']), str(hunted)[:200])

# --- wallet: request + list + ledger ---
s, req = seller.post('/wallet/requests/', {'coins': 200, 'amount': 4000, 'method': 'bank',
                                          'reference': f'TXN-{RUN}', 'screenshot_url': ''})
check('coin request 201', s == 201, f'{s} {req}')
check('request starts pending', req.get('status') == 'pending' and req.get('coins') == 200, str(req))
s, zero = seller.post('/wallet/requests/', {'coins': 0, 'amount': 0, 'method': 'qr'})
check('zero coins rejected', s == 400, f'{s} {zero}')
s, listing = seller.get('/wallet/requests/list/')
check('own requests listed', s == 200 and any(r['id'] == req['id'] for r in listing['results']), f'{s} {listing}')
s, theirs = buyer.get('/wallet/requests/list/')
check('requests scoped to the user', s == 200 and all(r['user'] != req['user'] for r in theirs['results']), str(theirs)[:200])
s, wallet = seller.get('/wallet/')
check('wallet page answers', s == 200 and 'results' in wallet, f'{s} {wallet}')
check('wallet carries balance', 'balance' in wallet, str(wallet))

print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
if FAIL:
    print('FAILED: ' + ', '.join(FAIL))
