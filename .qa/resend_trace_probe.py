"""Why a refused letter must arrive as the provider's sentence, not as a Python error."""

import os
import traceback

os.environ['DJANGO_SETTINGS_MODULE'] = 'exposing.settings'
os.environ['EMAIL_BACKEND'] = 'apps.common.email.EmailBackend'
os.environ['RESEND_API_KEY'] = 're_not_a_real_key_at_all'

import django  # noqa: E402

django.setup()

from apps.common.tasks import send_branded_email  # noqa: E402

try:
    send_branded_email('member.inbox@gmail.com', 'Exposing mail test', 'Heading', 'Body',
                       (('Sender', 'no-reply@exposing.app'),), '', '', '', '', {'email': 'support@exposing.app'})
except Exception:
    traceback.print_exc()
else:
    print('no error — Resend accepted it, which would be the surprise')
