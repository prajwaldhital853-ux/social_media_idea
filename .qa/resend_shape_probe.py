"""The letter a misconfigured box used to lose, now aimed at a provider on localhost.

A fake endpoint records exactly what the backend POSTs, so the shape the provider
sees — sender, both bodies, and the brand mark as an inline attachment — is proof
rather than an assumption. No key and no real provider is involved.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ['DJANGO_SETTINGS_MODULE'] = 'exposing.settings'
os.environ['EMAIL_BACKEND'] = 'apps.common.email.EmailBackend'
os.environ['RESEND_API_KEY'] = 're_local_test_key_not_a_real_one'
os.environ['RESEND_API_URL'] = 'http://127.0.0.1:9111/emails'

import django  # noqa: E402

django.setup()

from django.test import override_settings  # noqa: E402

from apps.adminpanel import maildesk  # noqa: E402

CAPTURED = []


class Provider(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        CAPTURED.append({
            'path': self.path,
            'auth': (self.headers.get('Authorization') or '')[:12],
            'agent': self.headers.get('User-Agent'),
            'json': json.loads(body.decode()),
        })
        payload = b'{"id":"fake-resend-id"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


server = HTTPServer(('127.0.0.1', 9111), Provider)
threading.Thread(target=server.serve_forever, daemon=True).start()

with override_settings(DEFAULT_FROM_EMAIL='Exposing <no-reply@exposing.app>'):
    code, body = maildesk.test_send('member.inbox@gmail.com')

print(f'test_send -> {code}')
print(body['detail'][:120])
sent = CAPTURED[-1]['json']
print(f'\nposted to {CAPTURED[-1]["path"]} auth={CAPTURED[-1]["auth"]}... agent={CAPTURED[-1]["agent"]}')
print('keys:', sorted(sent))
print('from:', sent['from'], 'to:', sent['to'])
print('subject:', sent['subject'])
print('text chars:', len(sent.get('text', '')), 'html chars:', len(sent.get('html', '')))
print('cid in html:', 'cid:exposing-logo' in sent.get('html', ''))
for part in sent.get('attachments', []):
    print('attachment:', {k: (v[:40] + '…' if isinstance(v, str) and len(v) > 40 else v)
                          for k, v in part.items()})
