from django.conf import settings
from django.db import models


class Post(models.Model):
    class Audience(models.TextChoices):
        PUBLIC = 'public', 'Public'
        FOLLOWERS = 'followers', 'Followers only'

    class Status(models.TextChoices):
        LIVE = 'live', 'Live'
        HIDDEN = 'hidden', 'Hidden by moderation'
        REMOVED = 'removed', 'Removed by moderation'

    class Activity(models.TextChoices):
        PROFILE = 'profile', 'New profile photo'
        COVER = 'cover', 'New cover photo'

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='posts')
    text = models.TextField(blank=True)
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.PUBLIC)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.LIVE)
    # A profile or cover change is published as a post; this says which, so the
    # feed can label it instead of showing an empty caption.
    activity = models.CharField(max_length=10, choices=Activity.choices, blank=True)
    mood = models.CharField(max_length=80, blank=True)
    place = models.CharField(max_length=120, blank=True)
    category = models.CharField(max_length=80, blank=True)
    like_count = models.PositiveIntegerField(default=0)
    comment_count = models.PositiveIntegerField(default=0)
    edited = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at'], name='post_newest_first'),
            models.Index(fields=['status', 'audience', '-created_at'], name='post_visible_newest'),
            models.Index(fields=['author', '-created_at'], name='post_author_newest'),
        ]

    def __str__(self):
        return f'{self.author.username}: {self.text[:40]}'


class PostMedia(models.Model):
    class Kind(models.TextChoices):
        IMAGE = 'image', 'Image'
        VIDEO = 'video', 'Video'

    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='media')
    kind = models.CharField(max_length=5, choices=Kind.choices, default=Kind.IMAGE)
    url = models.URLField(blank=True)
    file = models.FileField(upload_to='posts/', blank=True)
    duration = models.FloatField(null=True, blank=True)
    position = models.PositiveSmallIntegerField(default=0)
    like_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['position']

    def __str__(self):
        return f'{self.post_id}#{self.position} {self.kind}'