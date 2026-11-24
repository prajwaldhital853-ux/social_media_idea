from django.conf import settings
from django.db import models


class Report(models.Model):
    class Target(models.TextChoices):
        POST = 'post', 'Post'
        COMMENT = 'comment', 'Comment'
        USER = 'user', 'User'
        LISTING = 'listing', 'Listing'

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        REVIEWING = 'reviewing', 'Reviewing'
        RESOLVED = 'resolved', 'Resolved'
        DISMISSED = 'dismissed', 'Dismissed'

    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reports')
    target_type = models.CharField(max_length=10, choices=Target.choices)
    target_id = models.CharField(max_length=64)
    reason = models.CharField(max_length=80)
    details = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-created_at'], name='report_queue'),
            # The auto-hide threshold asks "how many open reports does this thing
            # have" on every report, and the review desks group the same way —
            # neither starts with `status`, so the queue index never served them.
            models.Index(fields=['target_type', 'target_id', 'status'], name='report_target_status'),
        ]

    def __str__(self):
        return f'{self.target_type}:{self.target_id} ({self.status})'


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='audit_entries')
    action = models.CharField(max_length=60)
    target = models.CharField(max_length=80, blank=True)
    detail = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        # The fastest-growing table in the app, and the audit desk pages straight
        # through it by time while the alerts sweep filters by action.
        indexes = [
            models.Index(fields=['-created_at'], name='audit_newest'),
            models.Index(fields=['action', '-created_at'], name='audit_action_recent'),
            models.Index(fields=['target'], name='audit_target'),
        ]