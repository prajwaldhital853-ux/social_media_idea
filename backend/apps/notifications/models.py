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