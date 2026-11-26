import time

from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import Throttled


def hit(key, limit, window):
    """Atomic fixed-window counter. Returns (allowed, current_count)."""
    bucket = f'rl:{key}:{int(time.time() // window)}'
    cache.add(bucket, 0, window)
    count = cache.incr(bucket)
    return count <= limit, count


def enforce(key, limit, window):
    # A ceiling of zero is the spam desk switching a rule off, not blocking
    # everything, which is what that desk says out loud to the seat typing it.
    if not settings.EXPOSING_RATE_LIMITS or limit <= 0:
        return
    allowed, _ = hit(key, limit, window)
    if not allowed:
        raise Throttled(wait=window)


def left(key, limit, window):
    """What this bucket may still spend in the running window, without spending it.

    A button needs to know whether pressing it is worth trying before it tries, and
    asking that question must not itself use up the room. None means no ceiling is
    in force -- either the switch is off or the desk set the number to zero -- so
    the caller never has to learn that zero means off.
    """
    if not settings.EXPOSING_RATE_LIMITS or limit <= 0:
        return None
    bucket = f'rl:{key}:{int(time.time() // window)}'
    spent = cache.get(bucket) or 0
    return max(0, limit - spent)


def client_ip(request):
    """The address this connection came from, read through the trusted proxies.

    Each trusted proxy appends the address it saw to X-Forwarded-For, so the
    client's real address sits EXPOSING_NUM_PROXIES hops from the end. The hops
    before it were written by the requester's own headers — naming the first
    one was how an address could claim to be anybody.
    """
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    proxies = settings.EXPOSING_NUM_PROXIES
    if forwarded and proxies > 0:
        hops = [hop.strip() for hop in forwarded.split(',')]
        return hops[-min(proxies, len(hops))]
    return request.META.get('REMOTE_ADDR', 'unknown')