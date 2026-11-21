from celery import shared_task
from django.core.mail import send_mail


@shared_task
def send_activity_email(to, subject, body, link):
    send_mail(
        subject,
        f'{body}\n\n{link}\n',
        'no-reply@exposing.app',
        [to],
        fail_silently=True,
    )
