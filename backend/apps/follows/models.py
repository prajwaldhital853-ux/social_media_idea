from django.conf import settings
from django.db import models


class Follow(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending request'
        ACCEPTED = 'accepted', 'Accepted'

    follower = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='following')
    followee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='followers')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACCEPTED)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['follower', 'followee'], name='one_follow_per_pair'),
            models.CheckConstraint(condition=~models.Q(follower=models.F('followee')), name='no_self_follow'),
        ]
        indexes = [
            models.Index(fields=['followee', 'status', '-created_at'], name='follow_followee_status'),
            models.Index(fields=['follower', 'status', '-created_at'], name='follow_follower_status'),
        ]

    def __str__(self):
        return f'{self.follower.username} -> {self.followee.username} ({self.status})'