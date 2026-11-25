"""Contract 6.6: the wording a visitor reads the first time the site loads.

The Client has seven days from the Agreement Date to supply it, which means the
platform cannot ship an empty box, it carries its own wording, and a line emptied
on purpose falls back to that rather than showing a card with nothing on it.

Two doors, deliberately different. This desk is the only place the wording
changes, and every change is written to the same audit log as a takedown. The
other is an open read, because the card appears before anybody has an account.
"""

import re

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import maildesk, rbac, settings_store
from .journal import record
from .models import AdminSetting

# (setting key, the field the screen posts, how long the line may be, what the
# console calls it, and what it tells the person typing).
LINES = (
    ('welcome_message', 'message', 300, 'Welcome message',
     'The first sentence on the card, before anyone has an account.'),
    ('tagline', 'tagline', 120, 'Tagline',
     'The short line under the welcome message.'),
    ('contact_email', 'email', 120, 'Email',
     'On the card, and at the foot of a suspension or warning email.'),
    ('contact_phone', 'phone', 60, 'Phone',
     'Left off the card and the email when the box is empty.'),
    ('contact_form', 'form', 200, 'Support form link',
     'The link at the bottom of the card, and the one an enforcement email points at.'),
    ('report_inbox', 'report_inbox', 120, 'Complaints inbox',
     'A copy of every report a user files is mailed to this address as it arrives. '
     'Left empty, complaints stay inside the console queue.'),
)
BY_KEY = {line[0]: line for line in LINES}
CONTACT_LABELS = (('contact_email', 'Email'), ('contact_phone', 'Phone'),
                  ('contact_form', 'Support form'))
# Rows the visitor never sees. They steer where the platform's own letters go, so
# they are written from the console but never printed on the first-load card.
MAIL_KEYS = frozenset({'report_inbox', 'console_url'})
MAIL_LABELS = frozenset({'Complaints inbox', 'Console address'})


def card():
    """What the site is handed, with nothing behind a login."""
    values = settings_store.values()
    return {
        'message': values['welcome_message'],
        'tagline': values['tagline'],
        'contact': [{'label': label, 'value': values[key]}
                    for key, label in CONTACT_LABELS if str(values[key] or '').strip()],
    }


def lines():
    """Each line as the desk needs it: current value, the platform's own, and who last wrote it."""
    cached = settings_store.cached()
    written = {row.key: row for row in AdminSetting.objects.filter(key__in=BY_KEY)}
    out = []
    for key, field, limit, label, help_text in LINES:
        item = cached[key]
        row = written.get(key)
        out.append({
            'key': key, 'field': field, 'label': label, 'help': help_text, 'limit': limit,
            'value': item['value'], 'default': item['default'], 'set': item['set'],
            'by': row.updated_by.username if row is not None and row.updated_by else None,
            'at': row.updated_at.isoformat() if row is not None else None,
        })
    return out


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('welcome_text')
def welcome_desk(request):
    if request.method == 'GET':
        return Response({'lines': lines(), 'card': card(), 'mail': maildesk.status()})

    stored = {row.key: (row.value or '') for row in AdminSetting.objects.filter(key__in=BY_KEY)}
    updates, too_long = {}, []
    for key, field, limit, label, _help in LINES:
        if field not in request.data:
            continue
        value = str(request.data.get(field) or '').strip()
        if len(value) > limit:
            too_long.append(f'{label} is {len(value)} characters and the line holds {limit}.')
            continue
        updates[key] = value
    if too_long:
        return Response({'detail': ' '.join(too_long)}, status=400)
    # What moved is measured against what is stored, not against what the card
    # shows: a line that falls back to the platform's own wording is still
    # unwritten, and saving it again would be an edit that changed nothing.
    moved = [BY_KEY[key][3] for key in updates if stored.get(key, '') != updates[key]]
    if not moved:
        return Response({'detail': 'Nothing to save, the card already says exactly this.'}, status=400)

    # The inbox and the console address are not a sentence the visitor reads, so the
    # promise about the first load would be a lie when only those moved.
    wording = [name for name in moved if name not in MAIL_LABELS]
    tail = (' The website reads it on the next first load; a line left empty falls back to the '
            'platform’s own wording.' if wording
            else ' The next letter the platform posts uses the new value.')
    settings_store.write(request.user, updates)
    record(request.user, 'welcome_text', 'first-load wording',
           'Wrote ' + ', '.join(moved) + '.')
    return Response({
        'lines': lines(), 'card': card(), 'mail': maildesk.status(),
        'detail': f'Saved {", ".join(moved).lower()}.{tail}',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('welcome_text')
def welcome_mail_test(request):
    """Send one real letter through this deployment's own mail settings.

    The contact details written here are the reply-to of every letter the platform
    posts, so the desk that edits them is the desk that has to prove they work.
    """
    to = str(request.data.get('to') or '').strip().lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', to):
        return Response({'detail': 'Write the address the test letter goes to.'}, status=400)
    code, body = maildesk.test_send(to)
    record(request.user, 'mail_test', to, body['detail'][:200])
    return Response(body, status=code)


@api_view(['GET'])
@permission_classes([AllowAny])
def welcome_public(request):
    """The card a visitor sees before they have an account, so this door is open."""
    return Response(card())
