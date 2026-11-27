from django.conf import settings
from django.db import models
from django.db.models import Q


class Notification(models.Model):
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='actions')
    notice = models.ForeignKey(
        'adminpanel.PublicNotice', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='notifications',
    )
    kind = models.CharField(max_length=40)
    target_type = models.CharField(max_length=20, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    text = models.CharField(max_length=240, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', '-created_at'], name='notif_recipient_newest'),
            # Every write asks "has this person already been told this by this
            # actor", and the badge counts the unread rows of one recipient.
            models.Index(fields=['recipient', 'actor', 'kind'], name='notif_dedupe'),
            models.Index(
                fields=['recipient'], condition=Q(read_at__isnull=True), name='notif_unread',
            ),
        ]

    def __str__(self):
        return f'{self.kind} -> {self.recipient.username}'


class PushSubscription(models.Model):
    """One browser that asked to be woken while Exposing is not open in it.

    The endpoint is an address at the browser's own push service, and the two
    keys are that browser's half of the message encryption: a card sealed for
    one device cannot be read by another, so nothing a member could not already
    see on their own screen is kept here. A row that goes stale costs one
    notification, not the account — the browser re-subscribes on the next visit.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='push_subscriptions',
    )
    endpoint = models.CharField(max_length=512, unique=True)
    p256dh = models.CharField(max_length=120)
    auth = models.CharField(max_length=64)
    # A push service that refuses one address over and over is an address that
    # is gone. Counting the refusals is how the row stops being signed for.
    fails = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'push -> {self.user.username}'