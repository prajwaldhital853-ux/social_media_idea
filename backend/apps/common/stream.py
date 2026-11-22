"""What every long-lived HTTP stream needs: a reader and a seat.

Both the bell and a chat thread hold one request open for minutes, so they
authenticate the same cookie the REST views read and spend from the same
per-account budget. Neither can afford to be picky about failure: a stream that
cannot start is the client's problem to retry, not a page that must break.
"""

from apps.accounts.auth import decode_token
from apps.accounts.models import User

# One process, one bookkeeping table. Multi-instance deploys move this into
# Redis alongside the channel layer.
_streams = {}


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
    """Take one of the account's stream slots, or say no if they are all held."""
    if _streams.get(user_pk, 0) >= limit:
        return False
    _streams[user_pk] = _streams.get(user_pk, 0) + 1
    return True


def release(user_pk):
    open_now = _streams.get(user_pk, 1)
    if open_now <= 1:
        _streams.pop(user_pk, None)
    else:
        _streams[user_pk] = open_now - 1


def held(user_pk):
    """How many seats this account has filled — for a test that a closed
    stream really did give its seat back."""
    return _streams.get(user_pk, 0)
