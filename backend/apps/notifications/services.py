from django.conf import settings
from django.utils import timezone

from apps.common.mail import send_off_request

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


def notify_latest(recipient, actor, kind, text, target_type='', target_id=''):
    """One row per person and event, re-stamped when that person repeats it.

    Chat is the case that needs it: a twelve-message thread would otherwise leave
    twelve identical bell rows and twelve unread on the badge, burying everything
    else the tray holds.
    """
    if recipient is None or (actor is not None and recipient.pk == actor.pk):
        return None
    row = Notification.objects.filter(recipient=recipient, actor=actor, kind=kind).first()
    if row is None:
        return notify(recipient, actor, kind, text, target_type, target_id)
    now = timezone.now()
    Notification.objects.filter(pk=row.pk).update(text=text[:240], read_at=None, created_at=now)
    row.text, row.read_at, row.created_at = text[:240], None, now
    return row


def email_activity(recipient, actor, kind):
    """One follower or request also lands in email, unless the member opted out."""
    copy = EMAIL_COPY.get(kind)
    if recipient is None or actor is None or copy is None or not recipient.email:
        return None
    if not getattr(recipient.profile, 'notify_email', True):
        return None
    subject, body = (line.format(name=name_of(actor), username=actor.username) for line in copy)
    send_off_request(send_activity_email, recipient.email, subject, body, f'{settings.SITE_URL}/u/{actor.username}')
    return subject


def name_of(user):
    return user.profile.display_name or user.username
