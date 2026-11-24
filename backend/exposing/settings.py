"""Django settings for the Exposing backend."""

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_list(name, default=''):
    # `or`, not a default argument: Render stores a key left blank in the UI as
    # an empty string, and an empty ALLOWED_HOSTS answers 400 DisallowedHost to
    # every request once DEBUG is off.
    raw = os.environ.get(name) or default
    return [item.strip() for item in raw.split(',') if item.strip()]


def _database():
    """Either a Render/Heroku style DATABASE_URL or the local POSTGRES_* pieces.

    The URL wins because hosted platforms hand out one connection string and
    rotate its password for you; splitting it into five variables would only
    invite a stale credential.
    """
    url = os.environ.get('DATABASE_URL', '').strip()
    if url:
        parsed = urlparse(url.replace('postgres://', 'postgresql://', 1))
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': unquote(parsed.path.lstrip('/')),
            'USER': unquote(parsed.username or ''),
            'PASSWORD': unquote(parsed.password or ''),
            'HOST': parsed.hostname or '',
            'PORT': str(parsed.port or 5432),
            # Render proxies Postgres through pgbouncer, which rejects the
            # server-side cursors Django would otherwise open.
            'OPTIONS': {'connect_timeout': 10},
            'DISABLE_SERVER_SIDE_CURSORS': True,
        }
    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('POSTGRES_DB', 'exposing'),
        'USER': os.environ.get('POSTGRES_USER', 'postgres'),
        'PASSWORD': os.environ.get('POSTGRES_PASSWORD', ''),
        'HOST': os.environ.get('POSTGRES_HOST', '127.0.0.1'),
        'PORT': os.environ.get('POSTGRES_PORT', '5434'),
    }


SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY') or 'django-insecure-dev-only-change-me'
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'
# The deployed host is handed out by Render only after the service exists, so
# the wildcard is the default rather than something every deploy must remember.
# Django's host matcher wants the leading-dot form; "*.onrender.com" matches nothing.
ALLOWED_HOSTS = _env_list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,.onrender.com')

INSTALLED_APPS = [
    # Daphne's runserver speaks both HTTP and WebSocket, so it must replace
    # Django's own dev server — hence first in the list.
    'daphne',
    'channels',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'apps.common',
    'apps.accounts',
    'apps.profiles',
    'apps.posts',
    'apps.comments',
    'apps.reactions',
    'apps.saved',
    'apps.marketplace',
    'apps.wallet',
    'apps.notifications',
    'apps.follows',
    'apps.messages',
    'apps.moderation',
    'apps.promotions',
    'apps.adminpanel',
]

MIDDLEWARE = [
    # First so the id is already stamped when a later middleware short-circuits a
    # request with a 403 or a 400.
    'apps.common.middleware.RequestIdMiddleware',
    'apps.common.middleware.ApiSlashMiddleware',
    'django.middleware.security.SecurityMiddleware',
    # Hosted platforms give the app one port and no web server, so Django has to
    # serve its own admin statics.
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'apps.common.security.SecurityHeadersMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'exposing.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'exposing.wsgi.application'
ASGI_APPLICATION = 'exposing.asgi.application'

# One process, one copy of the layer: enough for DM threads and typing. When the
# app ever runs as more than one instance, swap this for the Redis layer.
CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}

# A browser always sends Origin on a WebSocket handshake; anything not on this
# list is rejected before auth even runs.
WS_ORIGINS = _env_list('DJANGO_WS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000')

# Realtime budgets: per-user concurrent sockets/streams and SSE pacing. Kept as
# settings so tests can tighten time without patching module globals.
SSE_INTERVAL = float(os.environ.get('EXPOSING_SSE_INTERVAL') or '2')
# A thread is the one screen where two seconds reads as late: somebody is
# waiting for a reply. Costs one indexed query a second per open thread.
CHAT_SSE_INTERVAL = float(os.environ.get('EXPOSING_CHAT_SSE_INTERVAL') or '1')
# An open stream costs a task, a poll every tick and one of a user's stream
# slots for as long as it lives. Both EventSource clients carry a cursor and
# reopen on their own — the streams write `retry:` and read Last-Event-ID — so
# ending one every five minutes costs the reader nothing, and an hour-long hold
# no longer outlives a deploy.
SSE_MAX_LIFE = float(os.environ.get('EXPOSING_SSE_MAX_LIFE') or '300')
# Notifications and chat each hold one stream per tab, so three tabs is the
# ordinary desk: a cap of three refused the fourth tab mid-demo.
SSE_STREAMS_PER_USER = int(os.environ.get('EXPOSING_SSE_STREAMS') or '8')
WS_SOCKETS_PER_USER = int(os.environ.get('EXPOSING_WS_SOCKETS') or '8')

DATABASES = {'default': _database()}

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'apps.accounts.auth.CookieJWTAuthentication',
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_PAGINATION_CLASS': 'apps.common.pagination.KeysetPagination',
    'PAGE_SIZE': 10,
    'EXCEPTION_HANDLER': 'apps.common.errors.exception_handler',
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '120/min',
        'user': '600/min',
    },
}

REDIS_URL = os.environ.get('REDIS_URL') or 'redis://127.0.0.1:6379/0'


def _redis_up():
    import socket
    try:
        host_port = REDIS_URL.split('://', 1)[1].split('/', 1)[0]
        host, _, port = host_port.partition(':')
        with socket.create_connection((host, int(port or 6379)), timeout=0.3):
            return True
    except (OSError, IndexError):
        return False


REDIS_AVAILABLE = _redis_up()

CACHES = {
    'default': (
        {'BACKEND': 'django.core.cache.backends.redis.RedisCache', 'LOCATION': REDIS_URL}
        if REDIS_AVAILABLE else
        {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'exposing',
            # No Redis on the free tier, so throttle keys and cached fragments
            # live in this heap and the ceiling has to be a number somebody
            # chose: LocMem's own default is small enough that a minute of
            # distinct IPs evicts each other's counters, and a limiter that
            # cannot see its own keys is not one. Ten thousand counters is a
            # couple of megabytes. A blank env value reads as unset, as every
            # other value in this file does.
            'MAX_ENTRIES': int(os.environ.get('DJANGO_CACHE_MAX_ENTRIES') or '10000'),
            'CULL_FREQUENCY': int(os.environ.get('DJANGO_CACHE_CULL_FREQUENCY') or '3'),
        }
    )
}

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
# Nothing in this deployment runs a worker, so tasks execute inline. Reaching
# for a broker by default once cost every sign-in a 500. Set CELERY_ALWAYS_EAGER=0
# at the same time as you add a `celery worker` service, never before.
CELERY_TASK_ALWAYS_EAGER = (os.environ.get('CELERY_ALWAYS_EAGER') or '1') == '1'
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_BEAT_SCHEDULE = {
    'prune-expired-auth-rows': {
        'task': 'apps.accounts.tasks.prune_expired_auth_rows',
        'schedule': 3600.0,
    },
}

# `get_connection()` — and therefore send_mail — reads EMAIL_BACKEND. The name
# this file used to set, DEFAULT_EMAIL_BACKEND, is only what mail_admins() falls
# back to, so every OTP was dialled into localhost:25 and sat there for four
# seconds before fail_silently swallowed it. Console keeps the code in the
# service log until real SMTP lands.
# `or`, not a default argument: Render saves an empty key as '', and Django
# raises ImproperlyConfigured the moment an import path is blank.
EMAIL_BACKEND = os.environ.get('EMAIL_BACKEND') or 'django.core.mail.backends.console.EmailBackend'
DEFAULT_EMAIL_BACKEND = EMAIL_BACKEND
# Python opens a socket with no deadline, so one unreachable SMTP host was enough
# to hold a sign-up request open until the proxy gave up — which is the spinner,
# not a bug in the form. Ten seconds is longer than any working send.
EMAIL_TIMEOUT = float(os.environ.get('EMAIL_TIMEOUT') or '10')
# Providers differ in their API and nothing of theirs is worth a dependency: they
# all speak SMTP, so the dashboard picks the host and the key. Both encryption
# flags stay False when unset, because the text 'False' is truthy in Python.
EMAIL_HOST = os.environ.get('EMAIL_HOST') or 'localhost'
EMAIL_PORT = int(os.environ.get('EMAIL_PORT') or '25')
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER') or ''
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD') or ''
EMAIL_USE_TLS = (os.environ.get('EMAIL_USE_TLS') or '').lower() in ('1', 'true', 'yes')
EMAIL_USE_SSL = (os.environ.get('EMAIL_USE_SSL') or '').lower() in ('1', 'true', 'yes')
# Resend, Postmark and the rest refuse a letter whose sender is not a domain that
# was proved in their dashboard, so the address is a setting and not a string in
# the call — one key per deployment decides who the mail is from.
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL') or 'no-reply@exposing.app'
SERVER_EMAIL = DEFAULT_FROM_EMAIL
# A public absolute URL is required by mail clients. Blank uses the Exposing icon
# on SITE_URL; deployments can point this at their own CDN without a code change.
EMAIL_LOGO_URL = os.environ.get('EMAIL_LOGO_URL') or ''
# Render's free web services refuse outbound SMTP on 25, 465 and 587, so on that
# host EMAIL_BACKEND is apps.common.email.EmailBackend and this key is the mail
# settings. Both exist because neither provider works on the other's network.
RESEND_API_KEY = os.environ.get('RESEND_API_KEY') or ''
RESEND_API_URL = os.environ.get('RESEND_API_URL') or 'https://api.resend.com/emails'
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
# Emails quote a link back to the site; on Render the frontend lives on another
# host, so this is the browser origin rather than the API's own.
SITE_URL = (os.environ.get('EXPOSING_SITE_URL') or 'https://social-media-idea.vercel.app').rstrip('/')

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = 'DENY'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
if not DEBUG:
    # Render and Vercel both terminate TLS at their proxy, so the app only sees
    # http:// unless the forwarded protocol is trusted.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True

CORS_ALLOWED_ORIGINS = _env_list('CORS_ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000')
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = _env_list('DJANGO_CSRF_TRUSTED_ORIGINS')

EXPOSING_REPORT_THRESHOLD = int(os.environ.get('EXPOSING_REPORT_THRESHOLD') or '3')
EXPOSING_RATE_LIMITS = (os.environ.get('EXPOSING_RATE_LIMITS') or '1') == '1'
# Demo escape hatch: shows the one-time login code in the UI when no mail
# provider is configured. Off by default; never enable for a real launch.
EXPOSING_OTP_VISIBLE = os.environ.get('EXPOSING_OTP_VISIBLE', '0') == '1'

# Hosted platforms keep a log, not a file, and that log is the only way to learn
# what a "server could not finish that request" screenshot actually was. stdout,
# and every line carries the request id the client was handed back.
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'filters': {'request_id': {'()': 'apps.common.middleware.RequestIdFilter'}},
    'formatters': {
        'request': {'format': '%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s'},
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'request',
            'filters': ['request_id'],
            'stream': 'ext://sys.stdout',
        },
    },
    'root': {'handlers': ['console'], 'level': 'WARNING'},
    'loggers': {
        # Ours: failed requests, slow requests, swallowed mail failures.
        'apps': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
        'exposing': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
        # The traceback for a 500. RequestIdMiddleware already writes the one-line
        # summary of every 4xx, so this stays at ERROR rather than saying it twice.
        'django.request': {'handlers': ['console'], 'level': 'ERROR', 'propagate': False},
        'django.security': {'handlers': ['console'], 'level': 'WARNING', 'propagate': False},
    },
}

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'},
}
MEDIA_URL = 'media/'
# A hosted filesystem is disposable; a mounted disk keeps what people upload
# between deploys. Point MEDIA_DISK at a Render disk mount path when you have one.
MEDIA_ROOT = Path(os.environ.get('MEDIA_DISK') or '') if os.environ.get('MEDIA_DISK') else BASE_DIR / 'media'
# Off only when something in front of Django (a CDN, an nginx) owns /media.
SERVE_MEDIA = (os.environ.get('DJANGO_SERVE_MEDIA') or '1') == '1'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
# See apps/common/hashing.py: Django's own default work factor costs 3.4s per
# sign-in on this CPU, and sign-in is the first thing every visitor does. The
# second entry still verifies the hashes the old default wrote.
PASSWORD_HASHERS = [
    'apps.common.hashing.WorkFactorPasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher',
    'django.contrib.auth.hashers.Argon2PasswordHasher',
    'django.contrib.auth.hashers.BCryptSHA256PasswordHasher',
    'django.contrib.auth.hashers.ScryptPasswordHasher',
]
import sys
if "test" in sys.argv:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
