from django.conf import settings
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile')
    display_name = models.CharField(max_length=120, blank=True)
    bio = models.TextField(blank=True)
    avatar_url = models.URLField(blank=True)
    cover_url = models.URLField(blank=True)
    location = models.CharField(max_length=120, blank=True)
    province = models.CharField(max_length=80, blank=True)
    website = models.URLField(blank=True)
    phone = models.CharField(max_length=40, blank=True)
    links = models.JSONField(default=list, blank=True)
    verified = models.BooleanField(default=False)
    is_private = models.BooleanField(default=False)
    two_step = models.BooleanField(default=True)
    # The in-app bell always records an event; these decide what also lands in
    # the member's inbox — a staff warning on one line, follower and request
    # notices on the other, each switchable without touching the other.
    notify_email = models.BooleanField(default=True)
    notify_follow_email = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.display_name or self.user.username