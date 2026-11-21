from celery import shared_task
from django.core.mail import send_mail


@shared_task
def send_otp_email(email, code, purpose):
    subjects = {
        'login': 'Your Exposing sign-in code',
        'unlock': 'Unlock your Exposing account',
        'verify': 'Verify your Exposing email',
    }
    send_mail(
        subjects.get(purpose, 'Your Exposing code'),
        f'Your code is {code}. It expires in 10 minutes. If you did not request it, ignore this email.',
        'no-reply@exposing.app',
        [email],
        fail_silently=True,
    )


@shared_task
def prune_expired_auth_rows():
    from django.utils import timezone
    from .models import EmailOTP, RefreshSession
    cutoff = timezone.now()
    EmailOTP.objects.filter(expires_at__lt=cutoff).delete()
    RefreshSession.objects.filter(expires_at__lt=cutoff).delete()