"""What this deployment can actually do with a letter, and a button that proves it.

Mail is the part of the platform no screen can show: a letter the provider refuses
dies on its own thread with one line in the service log, which is how a deployment
runs for weeks believing its members are being emailed while none of them are. This
reads the settings, names the sender, and posts one real letter when asked, so the
answer to "is mail working?" is a click instead of a guess.
"""

from django.conf import settings
from django.core import mail as django_mail

from apps.common.emails import mail_delivery_problem, support_context
from apps.common.tasks import send_branded_email

SUBJECT = 'Exposing mail test'
HEADING = 'This letter left the platform'
MESSAGE = ('You asked the console whether mail is working. This is that answer, in the same '
           'template a member gets for a coin receipt, a promotion decision or a warning.')
FOOTNOTE = ('Nothing on any account changed to send this: it is a test letter from the staff '
            'console, and it is not stored anywhere.')


def backend_name():
    """The class Django would use to post a letter, or why it cannot be read."""
    try:
        return type(django_mail.get_connection()).__module__
    except Exception as err:
        return f'unreadable ({err.__class__.__name__})'


def status():
    """The four settings a letter passes through, plus the one sentence about them."""
    backend = backend_name()
    return {
        'backend': backend,
        'provider': ('Resend over HTTPS' if 'apps.common.email' in backend
                     else 'written to the server log only' if 'console' in backend or 'locmem' in backend
                     else 'SMTP' if 'smtp' in backend else backend),
        'sender': settings.DEFAULT_FROM_EMAIL,
        'reply_to': support_context()['email'],
        'site': settings.SITE_URL,
        'provider_key': bool((getattr(settings, 'RESEND_API_KEY', '') or '').strip()),
        # A letter handed to a queue nobody consumes is never posted, and nothing says so.
        'dispatch': 'thread' if getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', True) else 'queue',
        'problem': mail_delivery_problem(),
    }


def test_send(to):
    """Post one real letter on this request and report what the provider answered.

    Deliberately synchronous, unlike the event mail: here the answer *is* the point,
    and a seat waiting two seconds learns whether the next thousand letters arrive.
    """
    support = support_context()
    details = (
        ('Sender', settings.DEFAULT_FROM_EMAIL),
        ('Reply-to', support['email']),
        ('Provider', status()['provider']),
        ('Links point at', settings.SITE_URL),
    )
    try:
        send_branded_email(to, SUBJECT, HEADING, MESSAGE, details,
                           'Open Exposing', settings.SITE_URL, FOOTNOTE, '', support)
    except Exception as err:
        return 502, {
            'sent': False,
            'mail': status(),
            'detail': f'The letter did not leave. The provider said: {err}',
        }
    return 200, {
        'sent': True,
        'mail': status(),
        'detail': f'It went to {to}. If it is not in that inbox within a minute, check the spam '
                  'folder and then the sender domain in the provider, the platform handed it over.',
    }
