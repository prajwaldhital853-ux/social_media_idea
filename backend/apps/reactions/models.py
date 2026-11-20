from django.conf import settings
from django.db import models


class Reaction(models.Model):
    class Kind(models.TextChoices):
        LIKE = 'like', 'Like'
        LOVE = 'love', 'Love'
        HAHA = 'haha', 'Haha'
        WOW = 'wow', 'Wow'
        SAD = 'sad', 'Sad'
        ANGRY = 'angry', 'Angry'

    class Target(models.TextChoices):
        POST = 'post', 'Post'
        MEDIA = 'media', 'Media'
        COMMENT = 'comment', 'Comment'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reactions')
    target_type = models.CharField(max_length=10, choices=Target.choices)
    target_id = models.CharField(max_length=64)
    kind = models.CharField(max_length=5, choices=Kind.choices, default=Kind.LIKE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'target_type', 'target_id'], name='one_reaction_per_user_target'),
        ]
        indexes = [models.Index(fields=['target_type', 'target_id'], name='reaction_target_lookup')]

    def __str__(self):
        return f'{self.user.username} {self.kind} {self.target_type}:{self.target_id}'