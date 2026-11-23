from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

from apps.common.mail import send_off_request


@shared_task
def send_otp_email(email, code, purpose, minutes=10):
    subjects = {
        'login': 'Your Exposing sign-in code',
        'unlock': 'Unlock your Exposing account',
        'verify': 'Verify your Exposing email',
        'reset': 'Reset your Exposing password',
        'admin_reset': 'Reset your Exposing staff password',
    }
    # No try/except: this runs on the mail thread, where a raised SMTP error is the
    # only thing that reaches the log, and a silent one is a code nobody received.
    send_mail(
        subjects.get(purpose, 'Your Exposing code'),
        f'Your code is {code}. It expires in {minutes} minutes. '
        'If you did not request it, ignore this email.',
        settings.DEFAULT_FROM_EMAIL,
        [email],
        fail_silently=False,
    )


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