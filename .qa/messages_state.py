"""Deterministic starting point for .qa/messages_qa.mjs: two accounts that
follow each other, no threads, no bells."""
from apps.accounts.models import User
from apps.follows.models import Follow
from apps.messages.models import Conversation, Message
from apps.notifications.models import Notification

A = User.objects.get(username='kiran')
B = User.objects.get(username='ujjwal')

convs = Conversation.objects.filter(participants__in=[A, B])
Message.objects.filter(conversation__in=convs).delete()
convs.delete()
Notification.objects.filter(recipient__in=[A, B]).delete()
Follow.objects.filter(follower__in=[A, B]).delete()
Follow.objects.filter(followee__in=[A, B]).delete()
Follow.objects.create(follower=A, followee=B, status=Follow.Status.ACCEPTED)
Follow.objects.create(follower=B, followee=A, status=Follow.Status.ACCEPTED)
print(f'reset {A.username}/{B.username}: conv={Conversation.objects.filter(participants__in=[A, B]).count()} '
      f'notes={Notification.objects.filter(recipient__in=[A, B]).count()}')
