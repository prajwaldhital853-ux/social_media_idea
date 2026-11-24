"""What the app can say about itself before anyone signs in.

Two questions this answers, both of which cost a day each to ask by hand: is the
server asleep (so a stuck spinner is a cold start and not a bug), and which
database is it actually talking to (so an account that vanished can be placed).
"""

from django.conf import settings
from django.core.cache import caches
from django.db import connection
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


def _database():
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
        conf = settings.DATABASES['default']
        return {
            'ok': True,
            # 'sqlite' here on a deployed box means the accounts live on the
            # disposable filesystem, which is the disappearance nobody could see.
            'engine': conf['ENGINE'].rsplit('.', 1)[-1],
            'name': str(conf.get('NAME') or ''),
        }
    except Exception as exc:
        return {'ok': False, 'error': type(exc).__name__}


def _cache():
    try:
        backend = caches['default']
        backend.set('exposing:health', 'ping', 5)
        ok = backend.get('exposing:health') == 'ping'
        # LocMem answers per process, so a deploy or a second worker silently
        # resets every rate limit and every cached token bucket. Worth seeing.
        return {'ok': ok, 'backend': backend.__class__.__name__.replace('Cache', '')}
    except Exception as exc:
        return {'ok': False, 'backend': 'unknown', 'error': type(exc).__name__}


def _writable(path):
    import os
    return os.path.isdir(path) and os.access(path, os.W_OK)


def probe():
    database, cache = _database(), _cache()
    # The last segment is 'EmailBackend' for every backend there is; the one
    # before it is the only half that says where the mail goes.
    backend = settings.EMAIL_BACKEND.split('backends.', 1)[-1]
    return {
        'status': 'ok' if database['ok'] and cache['ok'] else 'degraded',
        'time': timezone.now().isoformat(),
        'database': database,
        'cache': cache,
        'email': {
            'backend': backend,
            # Console and locmem are sinks: nothing reaches a member. This
            # deployment's provider is the Resend backend, which posts over 443
            # because Render closes SMTP, so an smtp-shaped name was never the
            # test — and it told every reader that live mail was going nowhere.
            'delivered': not backend.startswith(('console.', 'locmem.', 'filebased.')),
            'timeout_seconds': settings.EMAIL_TIMEOUT,
        },
        'worker': {'eager': bool(settings.CELERY_TASK_ALWAYS_EAGER)},
        'media': {'writable': _writable(str(settings.MEDIA_ROOT))},
        'debug': bool(settings.DEBUG),
    }


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([])
@throttle_classes([])
def health(request):
    """Cheap, unauthenticated, never throttled — a client retries this to decide
    whether the API is waking up or actually broken."""
    return Response(probe())


@api_view(['GET', 'HEAD'])
@permission_classes([AllowAny])
@authentication_classes([])
@throttle_classes([])
def ping(request):
    """The cheapest possible yes: no query, no cache write, no disk, no clock.

    Two things ask only whether a process is listening and ask it repeatedly — a
    keep-alive cron holding a sleeping instance awake, and the browser polling
    while it waits out a cold start. Neither should put a load on the database
    just to hear a voice, and a cron that trips over a degraded probe would fall
    silent and let the instance sleep anyway, so this answers 200 unconditionally.
    """
    return Response({'status': 'ok'})
