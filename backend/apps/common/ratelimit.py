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
    if not settings.EXPOSING_RATE_LIMITS:
        return
    allowed, _ = hit(key, limit, window)
    if not allowed:
        raise Throttled(wait=window)


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