from django.conf import settings

from .models import Notification
from .tasks import send_activity_email

# Only these events are worth an inbox message; the bell already holds the rest.
EMAIL_COPY = {
    'follow': (
        '{name} started following you',
        '{name} ({username}) is now following you on Exposing.',
    ),
    'follow_request': (
        '{name} asked to follow you',
        '{name} ({username}) requested to follow your private account. Approve or decline '
        'the request in Notifications.',
    ),
}


def notify(recipient, actor, kind, text, target_type='', target_id=''):
    if recipient is None or (actor is not None and recipient.pk == actor.pk):
        return None
    return Notification.objects.create(
        recipient=recipient, actor=actor, kind=kind, text=text[:240],
        target_type=target_type, target_id=str(target_id),
    )


def email_activity(recipient, actor, kind):
    """One follower or request also lands in email, unless the member opted out."""
    copy = EMAIL_COPY.get(kind)
    if recipient is None or actor is None or copy is None or not recipient.email:
        return None
    if not getattr(recipient.profile, 'notify_email', True):
        return None
    subject, body = (line.format(name=name_of(actor), username=actor.username) for line in copy)
    send_activity_email.delay(recipient.email, subject, body, f'{settings.SITE_URL}/u/{actor.username}')
    return subject


def name_of(user):
    return user.profile.display_name or user.username
