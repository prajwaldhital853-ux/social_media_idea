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
