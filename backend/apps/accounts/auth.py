import hashlib
import uuid
from datetime import timedelta

import jwt
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import User

ACCESS_TTL = timedelta(minutes=15)
# A seat is ended by the person sitting in it, or by an admin locking the
# account — never by a clock. Every refresh hands out a token this long again,
# so a browser that is used at all rolls itself forward indefinitely; the number
# only decides how long an abandoned one may be replayed, and it is the longest
# lifetime browsers reliably keep a cookie for.
REFRESH_TTL = timedelta(days=400)
ALGORITHM = 'HS256'


def _encode(payload, ttl):
    now = timezone.now()
    body = {**payload, 'iat': int(now.timestamp()), 'exp': int((now + ttl).timestamp()), 'jti': uuid.uuid4().hex}
    return jwt.encode(body, settings.SECRET_KEY, algorithm=ALGORITHM), body


def issue_access(user, ttl=ACCESS_TTL):
    token, _ = _encode({'sub': str(user.pk), 'username': user.username, 'type': 'access'}, ttl)
    return token


def issue_refresh(user, device_id=''):
    from .models import RefreshSession
    token, body = _encode({'sub': str(user.pk), 'type': 'refresh', 'device': device_id}, REFRESH_TTL)
    RefreshSession.objects.create(
        user=user, jti=body['jti'], device_id=device_id,
        expires_at=timezone.now() + REFRESH_TTL,
    )
    return token


def decode_token(token, expected_type):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise AuthenticationFailed('Token expired.')
    except jwt.InvalidTokenError:
        raise AuthenticationFailed('Invalid token.')
    if payload.get('type') != expected_type:
        raise AuthenticationFailed('Wrong token type.')
    return payload


def hash_code(code):
    return hashlib.sha256(f'{settings.SECRET_KEY}:{code}'.encode()).hexdigest()


def set_auth_cookies(response, user, device_id='', access_ttl=None):
    # Render and Vercel both speak https to the browser, so the cookies have to
    # carry Secure; local dev runs DEBUG=1 over http and must keep working.
    secure = not settings.DEBUG
    # The console asks for a longer access token than a member sign-in: it has no
    # refresh dance of its own, so a 15-minute access cookie reads to the person
    # sitting at it as being signed out mid-task.
    response.set_cookie(
        'exposing_access', issue_access(user, access_ttl or ACCESS_TTL),
        max_age=int((access_ttl or ACCESS_TTL).total_seconds()),
        httponly=True, samesite='Lax', path='/', secure=secure,
    )
    response.set_cookie(
        'exposing_refresh', issue_refresh(user, device_id),
        max_age=int(REFRESH_TTL.total_seconds()), httponly=True, samesite='Lax', path='/api/auth', secure=secure,
    )
    response.set_cookie(
        'exposing_csrf', uuid.uuid4().hex,
        max_age=int(REFRESH_TTL.total_seconds()), httponly=False, samesite='Lax', path='/', secure=secure,
    )
    return response


def clear_auth_cookies(response):
    response.delete_cookie('exposing_access', path='/')
    response.delete_cookie('exposing_refresh', path='/api/auth')
    response.delete_cookie('exposing_csrf', path='/')
    return response


def _holds_a_seat(user):
    """Anybody the console signs in: the staff flag, the superuser crown, or a live seat."""
    if user.is_staff or user.is_superuser:
        return True
    from apps.adminpanel.models import StaffAccount
    return StaffAccount.objects.filter(user=user, is_enabled=True).exists()


class CookieJWTAuthentication(BaseAuthentication):
    # The console hands its seat this very cookie (`set_auth_cookies` in
    # `_grant`), so the staff check cannot be a refusal here: it would lock every
    # desk in the admin panel the moment it was written. The console's own doors
    # are the `api/admin/` ones, and a seat is read as a member nowhere else.
    CONSOLE_PREFIX = '/api/admin/'

    def authenticate_header(self, request):
        return 'Cookie'

    def authenticate(self, request):
        token = request.COOKIES.get('exposing_access')
        if not token:
            return None
        payload = decode_token(token, 'access')
        user = User.objects.filter(pk=int(payload['sub']), is_active=True, seeded=False).exclude(
            Q(is_staff=True) | Q(is_superuser=True) | Q(staff_account__isnull=False, staff_account__is_enabled=True)
        ).first()
        if not user:
            raise AuthenticationFailed('Account no longer active.')
        if user.is_suspended:
            raise AuthenticationFailed('Account suspended.')
        if not request.path.startswith(self.CONSOLE_PREFIX) and _holds_a_seat(user):
            # No identity at all on the member surface: an authenticated door
            # would answer 401 with a sentence about credentials, and the person
            # at it has just proved their credentials. The door stays anonymous.
            return None
        return user, payload