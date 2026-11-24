from celery import shared_task

from apps.common.emails import support_context
from apps.common.mail import send_off_request
from apps.common.tasks import send_code_email

# The sentence under the code, per door it opens. A person who asked for a reset
# and a person whose account is locked after wrong passwords are in different
# situations, and one generic line covers neither.
COPY = {
    'login': (
        'Your sign-in code',
        'Your Exposing sign-in code',
        'Use this code to finish signing in to Exposing.',
    ),
    'unlock': (
        'Unlock your Exposing account',
        'Unlock your account',
        'Use this code to unlock your Exposing account. It was locked after several '
        'sign-ins with the wrong password.',
    ),
    'verify': (
        'Verify your Exposing email',
        'Confirm your email address',
        'Use this code to confirm that this address is yours. It finishes setting up '
        'your Exposing account.',
    ),
    'reset': (
        'Reset your Exposing password',
        'Choose a new password',
        'Use this code to choose a new Exposing password. If you did not ask for one, '
        'your password has not changed.',
    ),
    'admin_reset': (
        'Reset your Exposing staff password',
        'Choose a new staff password',
        'Use this code to choose a new password for the Exposing staff console. This '
        'code does not affect your member account.',
    ),
}
FALLBACK = ('Your Exposing code', 'Your Exposing code', 'Use this code to continue.')


@shared_task
def send_otp_email(email, code, purpose, minutes=10):
    subject, heading, intro = COPY.get(purpose, FALLBACK)
    # No try/except: this runs on the mail thread, where a raised SMTP error is the
    # only thing that reaches the log, and a silent one is a code nobody received.
    send_code_email(email, subject, heading, intro, code, minutes, support_context())


def deliver_otp_email(email, code, purpose, minutes=10):
    """Post the code without spending the request's time on a mail provider.

    The row is already stored when this returns, and a person who never gets the
    mail has a resend button.
    """
    return send_off_request(send_otp_email, email, code, purpose, minutes)


@shared_task
def prune_expired_auth_rows():
    from datetime import timedelta

    from django.utils import timezone
    from .models import AuthBan, EmailOTP, RefreshSession
    cutoff = timezone.now()
    EmailOTP.objects.filter(expires_at__lt=cutoff).delete()
    RefreshSession.objects.filter(expires_at__lt=cutoff).delete()
    # A ban that has lifted stays a day longer than it lasted: that history is how
    # the next round of guessing knows it is not the first one.
    AuthBan.objects.filter(until__lt=cutoff - timedelta(days=1)).delete()
