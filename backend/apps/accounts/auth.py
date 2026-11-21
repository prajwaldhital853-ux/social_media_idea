import hashlib
import uuid
from datetime import timedelta

import jwt
from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import User

ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=7)
ALGORITHM = 'HS256'


def _encode(payload, ttl):
    now = timezone.now()
    body = {**payload, 'iat': int(now.timestamp()), 'exp': int((now + ttl).timestamp()), 'jti': uuid.uuid4().hex}
    return jwt.encode(body, settings.SECRET_KEY, algorithm=ALGORITHM), body


def issue_access(user):
    token, _ = _encode({'sub': str(user.pk), 'username': user.username, 'type': 'access'}, ACCESS_TTL)
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


def set_auth_cookies(response, user, device_id=''):
    response.set_cookie(
        'exposing_access', issue_access(user),
        max_age=int(ACCESS_TTL.total_seconds()), httponly=True, samesite='Lax', path='/',
    )
    response.set_cookie(
        'exposing_refresh', issue_refresh(user, device_id),
        max_age=int(REFRESH_TTL.total_seconds()), httponly=True, samesite='Lax', path='/api/auth',
    )
    response.set_cookie(
        'exposing_csrf', uuid.uuid4().hex,
        max_age=int(REFRESH_TTL.total_seconds()), httponly=False, samesite='Lax', path='/',
    )
    return response


def clear_auth_cookies(response):
    response.delete_cookie('exposing_access', path='/')
    response.delete_cookie('exposing_refresh', path='/api/auth')
    response.delete_cookie('exposing_csrf', path='/')
    return response


class CookieJWTAuthentication(BaseAuthentication):
    def authenticate_header(self, request):
        return 'Cookie'

    def authenticate(self, request):
        token = request.COOKIES.get('exposing_access')
        if not token:
            return None
        payload = decode_token(token, 'access')
        user = User.objects.filter(pk=int(payload['sub']), is_active=True).first()
        if not user:
            raise AuthenticationFailed('Account no longer active.')
        if user.is_suspended:
            raise AuthenticationFailed('Account suspended.')
        return user, payload