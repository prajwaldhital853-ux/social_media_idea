import random
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.common.ratelimit import client_ip, enforce
from apps.profiles.models import Profile

from .auth import (
    clear_auth_cookies, decode_token, hash_code, set_auth_cookies,
)
from .models import DeviceTrust, EmailOTP, RefreshSession, User
from .tasks import send_otp_email

LOCK_THRESHOLD = 3
LOCK_MINUTES = 15
OTP_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


def _device_id(request):
    return (request.data.get('device_id') or request.META.get('HTTP_X_DEVICE_ID') or '')[:80]


def _two_step(user):
    """New-device email codes, unless the owner turned trusted-device login off."""
    profile = getattr(user, 'profile', None)
    return bool(profile is None or profile.two_step)


def _make_otp(user, purpose, device_id=''):
    EmailOTP.objects.filter(user=user, purpose=purpose, consumed_at__isnull=True).update(consumed_at=timezone.now())
    code = f'{random.SystemRandom().randint(0, 999999):06d}'
    otp = EmailOTP.objects.create(
        user=user, purpose=purpose, code_hash=hash_code(code), device_id=device_id,
        expires_at=timezone.now() + timedelta(minutes=OTP_MINUTES),
    )
    send_otp_email.delay(user.email, code, purpose)
    return otp, code


def _otp_response(otp, code):
    body = {'challenge': otp.pk, 'expires_in': OTP_MINUTES * 60}
    if settings.DEBUG or getattr(settings, 'EXPOSING_OTP_VISIBLE', False):
        body['dev_code'] = code
    return body


def _trust_device(user, device_id, label=''):
    if device_id:
        DeviceTrust.objects.update_or_create(
            user=user, device_id=device_id,
            defaults={'label': label[:160] or request_label(user)},
        )


def request_label(user):
    return f'{user.username} device'


def _finish_login(request, user, device_id):
    user.failed_attempts = 0
    user.locked_until = None
    user.save(update_fields=['failed_attempts', 'locked_until'])
    _trust_device(user, device_id)
    resp = Response({'user': {'id': user.pk, 'username': user.username, 'email': user.email}})
    return set_auth_cookies(resp, user, device_id)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def signup(request):
    enforce(f'signup:{client_ip(request)}', 3, 3600)
    data = request.data
    username = (data.get('username') or '').strip().lower()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    name = (data.get('name') or '').strip()
    google = data.get('google') or {}
    if not username or not username.replace('_', '').replace('.', '').isalnum() or not 3 <= len(username) <= 30:
        return Response({'detail': 'Username must be 3-30 letters, numbers, dots or underscores.'}, status=400)
    try:
        validate_email(email)
    except DjangoValidationError:
        return Response({'detail': 'Enter a valid email address.'}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({'detail': 'That username is taken.'}, status=400)
    if User.objects.filter(email=email).exists():
        return Response({'detail': 'An account with that email already exists.'}, status=400)
    if not google:
        try:
            validate_password(password)
        except DjangoValidationError as e:
            return Response({'detail': ' '.join(e.messages)}, status=400)
    dob = data.get('dob') or None
    country = (data.get('country') or '').strip()[:80]
    if not dob or not country:
        return Response({'detail': 'Date of birth and country are required.'}, status=400)
    user = User.objects.create_user(
        username=username, email=email, password=password or None,
        first_name=name.split()[0] if name else '', last_name=' '.join(name.split()[1:]) if name else '',
        date_of_birth=dob, country=country, city=(data.get('city') or '').strip()[:80],
        provider='google' if google else 'email',
    )
    if google:
        user.email_verified = True
        user.save(update_fields=['email_verified'])
    Profile.objects.update_or_create(
        user=user,
        defaults={
            'display_name': name or username,
            'province': (data.get('province') or '').strip()[:80],
            'location': (data.get('city') or '').strip()[:120],
        },
    )
    device_id = _device_id(request)
    if not google:
        otp, code = _make_otp(user, 'verify', device_id)
    resp = Response(
        {'user': {'id': user.pk, 'username': user.username, 'email': user.email},
         **({} if google else _otp_response(otp, code))},
        status=status.HTTP_201_CREATED,
    )
    return set_auth_cookies(resp, user, device_id)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def login(request):
    ip = client_ip(request)
    enforce(f'login-ip:{ip}', 5, 60)
    identifier = (request.data.get('username') or request.data.get('email') or '').strip().lower()
    if not identifier:
        return Response({'detail': 'Enter your email or username.'}, status=400)
    enforce(f'login-id:{identifier}', 10, 60)
    password = request.data.get('password') or ''
    user = User.objects.filter(username=identifier).first() or User.objects.filter(email=identifier).first()
    if not user:
        return Response({'detail': 'No account matches those credentials.'}, status=401)
    if user.is_suspended:
        return Response({'detail': f'Account suspended: {user.suspend_reason}'}, status=403)
    if user.is_locked:
        return Response({
            'detail': f'Account locked after {LOCK_THRESHOLD} wrong passwords. Use the email unlock code or try again later.',
            'locked': True, 'locked_until': user.locked_until,
        }, status=423)
    if not user.check_password(password):
        user.failed_attempts += 1
        if user.failed_attempts >= LOCK_THRESHOLD:
            user.locked_until = timezone.now() + timedelta(minutes=LOCK_MINUTES)
            user.save(update_fields=['failed_attempts', 'locked_until'])
            otp, code = _make_otp(user, 'unlock')
            return Response({
                'detail': f'Account locked after {LOCK_THRESHOLD} wrong passwords. An unlock code was sent to your email.',
                'locked': True, 'locked_until': user.locked_until, **_otp_response(otp, code),
            }, status=423)
        user.save(update_fields=['failed_attempts'])
        return Response({
            'detail': 'Wrong password.', 'attempts_left': LOCK_THRESHOLD - user.failed_attempts,
        }, status=401)
    device_id = _device_id(request)
    trusted = bool(device_id) and DeviceTrust.objects.filter(user=user, device_id=device_id).exists()
    if trusted or not _two_step(user):
        if device_id:
            DeviceTrust.objects.filter(user=user, device_id=device_id).update(last_seen=timezone.now())
        return _finish_login(request, user, device_id)
    otp, code = _make_otp(user, 'login', device_id)
    return Response({
        'detail': 'New device detected. Enter the code sent to your email to continue.',
        'new_device': True, 'email_hint': user.email, **_otp_response(otp, code),
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def otp_verify(request):
    return _verify_otp(request)


def _verify_otp(request, force_purpose=None):
    challenge = request.data.get('challenge')
    enforce(f'otp:{challenge}', 10, 600)
    otp = EmailOTP.objects.filter(pk=challenge, consumed_at__isnull=True).select_related('user').first()
    if not otp or otp.expires_at < timezone.now():
        return Response({'detail': 'Code expired. Request a new one.'}, status=400)
    if force_purpose and otp.purpose != force_purpose:
        return Response({'detail': 'Wrong code type.'}, status=400)
    if otp.attempts >= OTP_MAX_ATTEMPTS:
        otp.consumed_at = timezone.now()
        otp.save(update_fields=['consumed_at'])
        return Response({'detail': 'Too many wrong codes. Request a new one.'}, status=400)
    if hash_code(str(request.data.get('code') or '')) != otp.code_hash:
        otp.attempts += 1
        otp.save(update_fields=['attempts'])
        return Response({'detail': 'Wrong code.', 'attempts_left': OTP_MAX_ATTEMPTS - otp.attempts}, status=400)
    otp.consumed_at = timezone.now()
    otp.save(update_fields=['consumed_at'])
    user = otp.user
    device_id = otp.device_id or _device_id(request)
    if otp.purpose == 'unlock':
        user.failed_attempts = 0
        user.locked_until = None
        user.save(update_fields=['failed_attempts', 'locked_until'])
        return Response({'detail': 'Account unlocked. Sign in with your password.'})
    if otp.purpose == 'verify':
        user.email_verified = True
        user.save(update_fields=['email_verified'])
    return _finish_login(request, user, device_id)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def otp_resend(request):
    challenge = request.data.get('challenge')
    otp = EmailOTP.objects.filter(pk=challenge).select_related('user').first()
    if not otp:
        return Response({'detail': 'Unknown challenge.'}, status=400)
    enforce(f'otp-resend:{otp.user_id}', 3, 600)
    new_otp, code = _make_otp(otp.user, otp.purpose, otp.device_id)
    return Response(_otp_response(new_otp, code))


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def refresh(request):
    enforce(f'refresh:{client_ip(request)}', 30, 60)
    token = request.COOKIES.get('exposing_refresh')
    if not token:
        return Response({'detail': 'No refresh token.'}, status=401)
    payload = decode_token(token, 'refresh')
    session = RefreshSession.objects.filter(jti=payload['jti'], revoked_at__isnull=True).select_related('user').first()
    if not session or session.expires_at < timezone.now():
        return Response({'detail': 'Session revoked or expired. Sign in again.'}, status=401)
    session.revoked_at = timezone.now()
    session.save(update_fields=['revoked_at'])
    resp = Response({'refreshed': True})
    return set_auth_cookies(resp, session.user, session.device_id)


@api_view(['POST'])
@permission_classes([AllowAny])
def logout(request):
    token = request.COOKIES.get('exposing_refresh')
    if token:
        try:
            payload = decode_token(token, 'refresh')
            RefreshSession.objects.filter(jti=payload['jti']).update(revoked_at=timezone.now())
        except Exception:
            pass
    return clear_auth_cookies(Response({'detail': 'Signed out.'}))


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def unlock_request(request):
    identifier = (request.data.get('email') or request.data.get('username') or '').strip().lower()
    enforce(f'unlock:{identifier}', 3, 600)
    # Sign-in accepts either handle, so unlocking has to accept the same two.
    user = User.objects.filter(email=identifier).first() or User.objects.filter(username=identifier).first()
    if not user:
        return Response({'detail': 'If that email exists, an unlock code is on its way.'})
    otp, code = _make_otp(user, 'unlock')
    return Response({'detail': 'Unlock code sent.', **_otp_response(otp, code)})


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def unlock_confirm(request):
    return _verify_otp(request, force_purpose='unlock')


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def google(request):
    enforce(f'google:{client_ip(request)}', 10, 60)
    data = request.data
    client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
    if client_id:
        import urllib.request
        import json as _json
        from django.core.cache import cache
        certs = cache.get('google-jwks')
        if not certs:
            with urllib.request.urlopen('https://www.googleapis.com/oauth2/v3/certs', timeout=5) as r:
                certs = _json.load(r)
            cache.set('google-jwks', certs, 3600)
        import jwt as pyjwt
        from jwt import PyJWKClient
        try:
            claims = pyjwt.decode(
                data.get('id_token'), PyJWKClient('https://www.googleapis.com/oauth2/v3/certs').get_signing_key_from_jwt(data.get('id_token')).key,
                algorithms=['RS256'], audience=client_id, issuer='https://accounts.google.com',
            )
        except Exception:
            return Response({'detail': 'Google token verification failed.'}, status=401)
        email, name, sub = claims.get('email', ''), claims.get('name', ''), claims.get('sub', '')
    else:
        if not settings.DEBUG:
            # The demo branch believes whatever identity the client claims, so it exists
            # for local QA only — production must verify a real Google token.
            return Response({'detail': 'Google sign-in is not configured on this server.'}, status=503)
        demo = data.get('demo') or {}
        email, name, sub = (demo.get('email') or '').lower(), demo.get('name') or '', demo.get('sub') or ''
        if not email or not sub:
            return Response({'detail': 'Google sign-in is not configured on this server.'}, status=503)
    user = User.objects.filter(email=email).first()
    device_id = _device_id(request)
    if user:
        if user.provider != 'google':
            user.provider = 'google'
            user.save(update_fields=['provider'])
        if (device_id and DeviceTrust.objects.filter(user=user, device_id=device_id).exists()) or not _two_step(user):
            return _finish_login(request, user, device_id)
        otp, code = _make_otp(user, 'login', device_id)
        return Response({'new_device': True, 'email_hint': email, **_otp_response(otp, code)}, status=202)
    return Response({
        'needs_signup': True,
        'prefill': {'email': email, 'name': name, 'google_sub': sub},
        'detail': 'Finish creating your account: pick a username, date of birth and country.',
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    from apps.common.sync import me_payload
    return Response(me_payload(request.user))