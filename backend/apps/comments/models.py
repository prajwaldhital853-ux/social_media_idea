from django.conf import settings
from django.db import models


class Comment(models.Model):
    class Status(models.TextChoices):
        LIVE = 'live', 'Live'
        HIDDEN = 'hidden', 'Hidden by moderation'
        REMOVED = 'removed', 'Removed by moderation'

    post = models.ForeignKey('posts.Post', on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='comments')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='replies')
    media_index = models.PositiveSmallIntegerField(null=True, blank=True)
    text = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.LIVE)
    like_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['-created_at'], name='comment_newest_first')]

    def __str__(self):
        return f'{self.author.username} on {self.post_id}: {self.text[:40]}'