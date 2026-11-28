"""One-frame nudges for everyone holding the site open.

The bell stream already reaches every signed-in tab; these are the tiny frames
that ride it beside notifications: a tally that moved, a balance that changed,
a campaign that was decided, a post that just went live. Every frame carries
the whole current state of the thing it names — absolute numbers, never deltas
— so a frame delivered twice or a stream that reconnects cannot double-count
anything, and a frame dropped on a busy tick costs nothing that the next page
read will not heal.

Emitting one is best-effort: a nudge that cannot be delivered never blocks the
write that raised it, and a nudge that reaches nobody just means the reader is
one reload away from the same truth.
"""

import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.serializers.json import DjangoJSONEncoder


def _send(group, event):
    try:
        frame = json.dumps(event, cls=DjangoJSONEncoder, separators=(',', ':'))
        async_to_sync(get_channel_layer().group_send)(group, {'type': 'pulse', 'frame': frame})
    except Exception:  # noqa: BLE001 - the wire is a courtesy, the write is the job
        pass


def to_user(user_pk, kind, **fields):
    """One account's private wire: their money, their campaigns, their warnings."""
    if user_pk:
        _send(f'user.{user_pk}', {'kind': kind, **fields})


def to_site(kind, **fields):
    """Every open tab. Content-free frames only — ids and counts, never words."""
    _send('site', {'kind': kind, **fields})


def to_post(post_pk, kind, **fields):
    """Readers of one visible post; the stream rechecks access before each frame."""
    if post_pk:
        _send(f'post.{post_pk}', {'kind': kind, **fields})


def to_staff(kind, **fields):
    """Console seats. Operational ids and counts only, never private content."""
    _send('staff', {'kind': kind, **fields})


def notice_landed(notice):
    """Push a notice the desk just wrote onto the cards that must show it.

    The banner under a suspended post quotes the sentence, so unlike every other
    frame here this one carries words — which is why it is routed by audience
    instead of sprayed. A public notice belongs in front of everyone reading that
    content; a private one is a note to a single account about its own page, and
    only that account's wire sees it. A seat that misses the frame still learns
    the same thing on its next read, so this stays a courtesy.
    """
    from apps.adminpanel.models import PublicNotice

    about = getattr(notice, 'about', None)
    if about is None:
        return
    private = notice.audience == PublicNotice.Audience.PRIVATE
    fields = {
        'target': notice.target_type,
        'id': str(notice.target_id),
        'about': about.username,
        'notice': {
            'id': notice.pk,
            'text': notice.text,
            'reason': notice.reason,
            'by': notice.actor.username if notice.actor else 'staff',
            'at': notice.created_at,
            'private': private,
        },
    }
    if private:
        to_user(about.pk, 'notice_new', **fields)
    else:
        to_site('notice_new', **fields)
