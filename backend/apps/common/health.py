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
            # Console means no member ever receives a code; the OTP-on-screen
            # escape hatch is the only thing keeping sign-up alive.
            'delivered': backend.startswith('smtp'),
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
