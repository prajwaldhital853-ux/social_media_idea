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
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', 'unknown')