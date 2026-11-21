"""Simple concurrent load test against the live API.

Usage: .venv/Scripts/python.exe loadtest.py [users] [requests_per_user] [workers]
Defaults: 20 users, 15 requests each, 10 workers. Reports p50/p95/max latency,
throughput, error codes, and verifies the shared like counter stays exact.
"""
import http.cookiejar
import json
import random
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = 'http://127.0.0.1:8001/api'
USERS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
REQS = int(sys.argv[2]) if len(sys.argv) > 2 else 15
WORKERS = int(sys.argv[3]) if len(sys.argv) > 3 else 10
RUN = str(int(time.time()))[-6:]


class Session:
    def __init__(self, ip):
        self.ip = ip
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        req.add_header('X-Forwarded-For', self.ip)
        csrf = next((c.value for c in self.jar if c.name == 'exposing_csrf'), '')
        if method != 'GET' and csrf:
            req.add_header('X-CSRF-Token', csrf)
        start = time.perf_counter()
        try:
            resp = self.opener.open(req, timeout=30)
            payload = json.loads(resp.read() or b'{}')
            code = resp.status
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b'{}')
            except json.JSONDecodeError:
                payload = {}
            code = e.code
        except Exception as e:
            payload, code = {'error': str(e)}, 0
        return code, payload, (time.perf_counter() - start) * 1000


def onboard(i):
    s = Session(f'10.88.{i // 250}.{i % 250 + 1}')
    username = f'load{RUN}u{i}'
    code, body, _ = s.call('POST', '/auth/signup/', {
        'username': username, 'email': f'{username}@load.test', 'password': 'Load-Pass-9271',
        'name': f'Load User {i}', 'dob': '1997-03-08', 'country': 'Nepal', 'city': 'Kathmandu',
        'device_id': f'dev-{username}',
    })
    if code != 201:
        return None, f'signup {code}: {body}'
    code, body, _ = s.call('POST', '/auth/otp/', {'challenge': body['challenge'], 'code': body['dev_code'], 'device_id': f'dev-{username}'})
    if code != 200:
        return None, f'otp {code}: {body}'
    return (username, s), None


def main():
    print(f'Load test: {USERS} users x {REQS} requests, {WORKERS} workers -> {BASE}')
    sessions, errors = [], []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for result, err in pool.map(onboard, range(USERS)):
            if err:
                errors.append(err)
            else:
                sessions.append(result)
    if not sessions:
        print('Onboarding failed:', errors[:5])
        sys.exit(1)
    print(f'Onboarded {len(sessions)} users ({len(errors)} errors)')

    anchor_user, anchor_session = sessions[0]
    code, anchor, _ = anchor_session.call('POST', '/posts/', {'text': f'load anchor {RUN}', 'audience': 'public'})
    anchor_id = anchor['id']

    latencies, codes = [], {}
    likes_ok = [0] * len(sessions)

    def workload(item):
        idx, (username, s) = item
        local = []
        rng = random.Random(idx)
        for step in range(REQS):
            roll = rng.random()
            if roll < 0.4:
                code, body, ms = s.call('GET', '/feed/')
            elif roll < 0.6:
                code, body, ms = s.call('POST', '/reactions/', {'target_type': 'post', 'target_id': str(anchor_id), 'kind': 'like'})
                if code == 201:
                    likes_ok[idx] = 1
            elif roll < 0.75:
                target = sessions[(idx + 1) % len(sessions)][0]
                code, body, ms = s.call('POST', f'/messages/{target}/', {'text': f'load msg {idx}-{step}'})
            elif roll < 0.9:
                code, body, ms = s.call('POST', '/posts/', {'text': f'load post {idx}-{step}', 'audience': 'public'})
            else:
                code, body, ms = s.call('GET', '/notifications/')
            local.append((code, ms))
        return local

    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for results in pool.map(workload, list(enumerate(sessions))):
            for code, ms in results:
                latencies.append(ms)
                codes[code] = codes.get(code, 0) + 1
    elapsed = time.perf_counter() - start

    code, post, _ = anchor_session.call('GET', f'/posts/{anchor_id}/')
    expected_likes = sum(likes_ok)
    counter_ok = post.get('like_count') == expected_likes

    latencies.sort()
    p50 = latencies[len(latencies) // 2]
    p95 = latencies[int(len(latencies) * 0.95)]
    print(f'\nRequests: {len(latencies)} in {elapsed:.1f}s ({len(latencies) / elapsed:.0f} req/s)')
    print(f'Latency ms: p50={p50:.0f} p95={p95:.0f} max={latencies[-1]:.0f}')
    print('Status codes:', dict(sorted(codes.items())))
    print(f'Like counter: expected {expected_likes}, got {post.get("like_count")} -> {"OK" if counter_ok else "MISMATCH"}')
    bad = {c: n for c, n in codes.items() if c not in (200, 201)}
    if bad or not counter_ok:
        print('FAILURES:', bad)
        sys.exit(1)
    print('LOAD TEST PASSED')


if __name__ == '__main__':
    main()