"""Second-factor plumbing: the admin cookie and the TOTP secret at rest.

Kept apart from `apps.accounts.auth` because the two tokens answer different
questions. An `exposing_access` cookie says "this person signed in"; an
`exposing_admin` cookie says "this browser proved a second factor for the admin
console", and only the second one opens these doors. It carries no expiry and no
`max-age`: it is handed out when the seat signs in and the browser throws it away
when the tab or the machine closes, which is the lifetime a person at a desk
actually expects. The main login flow is untouched, so a staff member can still
browse the site the way the rest of the platform expects.
"""

import base64
import hashlib
import time
import uuid
from datetime import timedelta

import jwt
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.utils import timezone

ALGORITHM = 'HS256'
SETUP_TTL = timedelta(minutes=10)

ADMIN_COOKIE = 'exposing_admin'
SETUP_COOKIE = 'exposing_admin_setup'


def _key(material):
    return hashlib.sha256(f'adminpanel:{material}'.encode()).digest()


def _fernet():
    # Fernet wants 32 url-safe base64 bytes; the digest of SECRET_KEY is exactly that.
    return Fernet(base64.urlsafe_b64encode(_key(settings.SECRET_KEY)))


def encrypt_secret(value):
    if not value:
        return ''
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(token):
    if not token:
        return ''
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        # A rotated SECRET_KEY leaves stored secrets unreadable. Say so through the
        # normal path, re-enrolment, instead of 500-ing every admin request.
        return ''


def _encode(payload, ttl):
    now = timezone.now()
    body = {**payload, 'iat': int(now.timestamp()), 'jti': uuid.uuid4().hex}
    # No ttl means no expiry claim at all: the proof lives as long as the browser
    # does, which is what a seat means by "do not sign me out while I am working".
    if ttl is not None:
        body['exp'] = int((now + ttl).timestamp())
    return jwt.encode(body, settings.SECRET_KEY, algorithm=ALGORITHM), body


def issue_admin_token(user, kind='admin', amr=('totp',), ttl=None):
    return _encode({'sub': str(user.pk), 'type': f'admin_{kind}', 'amr': list(amr)}, ttl)[0]


def read_admin_token(token, kind='admin'):
    """Return the payload, or None for anything that is not a live admin token.

    Every branch here is a denial, not an error: an expired, mistyped, wrong-type
    or stolen-but-revoked token has to read the same way to the caller.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get('type') != f'admin_{kind}':
        return None
    return payload


def set_admin_cookie(response, token, kind='admin'):
    secure = not settings.DEBUG
    # The admin proof is written without an expiry: the browser drops it when the
    # tab or the machine closes, and nothing else ends it. The sign-in step keeps
    # its own short clock, because a half-finished password check is not a session.
    max_age = None if kind == 'admin' else int(SETUP_TTL.total_seconds())
    response.set_cookie(
        ADMIN_COOKIE if kind == 'admin' else SETUP_COOKIE,
        token,
        max_age=max_age, httponly=True, samesite='Lax', path='/', secure=secure,
    )
    return response


def clear_admin_cookies(response):
    response.delete_cookie(ADMIN_COOKIE, path='/')
    response.delete_cookie(SETUP_COOKIE, path='/')
    return response
