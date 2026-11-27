"""What every long-lived HTTP stream needs: a reader and a seat.

Both the bell and a chat thread hold one request open for minutes, so they
authenticate the same cookie the REST views read and spend from the same
per-account budget. Neither can afford to be picky about failure: a stream that
cannot start is the client's problem to retry, not a page that must break.
"""

import time
import uuid

from django.conf import settings

from apps.accounts.auth import decode_token
from apps.accounts.models import User

# One process, one bookkeeping table. Multi-instance deploys move this into
# Redis alongside the channel layer.
#
# A seat is a lease, not a count. A stream hands its seat back the moment its
# body ends, but a body that never started — the browser hung up before the
# first byte, so the generator was made and never run — has no finally block
# left to run, and a plain counter would keep that seat for the account until
# the process restarted. So every lease carries the hour it should have been
# given back by, and the next acquire sweeps whatever is overdue.
_leases = {}

# A stream closes itself at SSE_MAX_LIFE; one still held past that plus a
# breath of slack belongs to a body that is never coming back.
GRACE = 15.0


def stream_user(request):
    """The signed-in user behind a stream request, or None.

    This is a plain Django view, not a DRF one — a streamed response cannot go
    through the renderer — so the cookie is decoded here rather than by the
    authentication class the API views use.
    """
    token = request.COOKIES.get('exposing_access')
    if not token:
        return None
    try:
        payload = decode_token(token, 'access')
    except Exception:
        return None
    return User.objects.filter(pk=int(payload['sub']), is_active=True).first()


def acquire(user_pk, limit):
    """Take one of the account's stream slots, or say no if they are all held.

    The id is the receipt: hand it back to `release` when the body ends.
    """
    now = time.monotonic()
    seats = _leases.get(user_pk)
    if seats:
        for stale in [ticket for ticket, due in seats.items() if due <= now]:
            seats.pop(stale, None)
        if len(seats) >= limit:
            return ''
    ticket = uuid.uuid4().hex[:12]
    _leases.setdefault(user_pk, {})[ticket] = now + float(settings.SSE_MAX_LIFE) + GRACE
    return ticket


def release(user_pk, ticket):
    """Give one named seat back. An unknown ticket is a stream already swept."""
    seats = _leases.get(user_pk)
    if not seats:
        return
    seats.pop(ticket, None)
    if not seats:
        _leases.pop(user_pk, None)


def held(user_pk):
    """How many seats this account has filled — for a test that a closed
    stream really did give its seat back."""
    return len(_leases.get(user_pk) or {})
