"""Seed the precondition .qa/lists_regression.mjs needs: one unread DM to sita.

With every thread read, markThreadRead's badge guard closes after one call and
the inbox-refetch loop cannot start, so the check would pass against code that
is still broken. This creates exactly one row and records its id so --undo
removes only what it added.

  cd backend
  <repo venv>/Scripts/python.exe qa_fixture_unread.py
  <repo venv>/Scripts/python.exe qa_fixture_unread.py --undo
"""
import json
import os
import sys

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from apps.accounts.models import User
from apps.messages.models import Conversation, Message

SIDE = 'D:/Temp/qa-fixture-unread.json'

sita = User.objects.get(username='sita')
other = User.objects.filter(username__in=['hari', 'gita', 'ramesh', 'bibek', 'anjal']).exclude(username='sita').order_by('username').first()

if '--undo' in sys.argv:
    created = json.load(open(SIDE))
    Message.objects.filter(id__in=created['messages']).delete()
    Conversation.objects.filter(id__in=created['conversations']).delete()
    print('removed', created)
    os.remove(SIDE)
    sys.exit(0)

# Two filter() calls are two joins; filter(participants=a, participants=b) asks
# one participant row to be both people at once and can never match.
conv = Conversation.objects.filter(participants=sita).filter(participants=other).first()
created_conv = conv is None
if not conv:
    conv = Conversation.objects.create(last_message_at=None)
    conv.participants.set([sita, other])

msg = Message.objects.create(conversation=conv, sender=other, text='QA fixture: unread row', read_at=None)
conv.last_message_at = msg.created_at
conv.save(update_fields=['last_message_at'])

json.dump({'messages': [msg.pk], 'conversations': [conv.pk] if created_conv else []}, open(SIDE, 'w'))
print(f'message {msg.pk}: {other.username} -> sita in conversation {conv.pk} (new conversation: {created_conv})')
