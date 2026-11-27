from django.conf import settings
from django.db import models


class Conversation(models.Model):
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='conversations')
    last_message_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['-last_message_at'], name='conversation_recent')]

    def __str__(self):
        return f'Conversation {self.pk}'


class ConversationHide(models.Model):
    """One participant's decision that a thread stops appearing in their inbox.

    The row is theirs alone: the other member keeps the thread, and a message
    that later crosses in either direction puts it back — a delete here is a
    tidy-up, not an erasure of anybody's history."""

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='hides')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='conversation_hides')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['conversation', 'user'], name='one_hide_per_participant')]
        indexes = [models.Index(fields=['user'], name='conversation_hide_user')]


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_messages')
    text = models.TextField()
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [models.Index(fields=['conversation', 'created_at'], name='message_conversation_time')]

    def __str__(self):
        return f'{self.sender.username}: {self.text[:40]}'