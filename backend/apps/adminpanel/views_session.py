"""Signing in to the admin console: password first, authenticator code second.

The main site's `/api/auth/login/` is deliberately not reused and not modified. A
staff member browsing the platform as a person goes through that door; this door
only opens once an authenticator code has been proved, and the proof is carried by
its own 30-minute cookie so every admin endpoint can demand it again.
"""

import secrets
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.auth import clear_auth_cookies, hash_code, set_auth_cookies
from apps.accounts.models import User
from apps.common.ratelimit import client_ip, enforce

from . import rbac, totp
from .journal import record
from .models import StaffAccount, PASSWORD_LOCK_MINUTES, TOTP_LOCK_MINUTES
from .tokens import (
    ADMIN_COOKIE, ADMIN_TTL, SETUP_COOKIE, SETUP_TTL, clear_admin_cookies, issue_admin_token,
    read_admin_token, set_admin_cookie,
)

ISSUER = getattr(settings, 'ADMIN_2FA_ISSUER', 'Exposing')
RECOVERY_COUNT = 10
# No I, O, L or 1: a code read aloud over the phone cannot be mistyped into a
# lockout.
_RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'


def _otpauth(username, secret):
    # The colon between issuer and account stays literal: that is the label shape
    # Google Authenticator and 1Password parse into two columns.
    label = quote(f'{ISSUER}:{username}', safe=':')
    return (
        f'otpauth://totp/{label}'
        f'?secret={secret}&issuer={quote(ISSUER)}&algorithm=SHA1&digits={totp.DIGITS}&period={totp.PERIOD}'
    )


def _enrolment_payload(staff):
    secret = staff.provision_secret()
    return {
        'secret': secret,
        'otpauth_url': _otpauth(staff.user.username, secret),
        'issuer': ISSUER,
        'account': staff.user.username,
        'digits': totp.DIGITS,
        'period': totp.PERIOD,
    }


def _new_recovery_codes():
    plain, stored = [], []
    for _ in range(RECOVERY_COUNT):
        raw = ''.join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(12))
        shown = '-'.join(raw[i:i + 4] for i in range(0, 12, 4))
        plain.append(shown)
        stored.append(hash_code(shown))
    # The plaintext copy exists only inside this response; the row keeps hashes.
    return plain, stored


def _principal(request):
    """Whose code is being proved: the pending sign-in, or a live staff session."""
    pending = read_admin_token(request.COOKIES.get(SETUP_COOKIE, ''), kind='setup')
    if pending and pending.get('sub'):
        return User.objects.filter(pk=int(pending['sub']), is_active=True).first()
    user = getattr(request, 'user', None)
    if user is not None and user.is_authenticated and user.is_staff:
        return user
    return None


def _held_keys(staff):
    """The seat's effective keys, plus the labels the console renders next to them."""
    keys = rbac.permissions_for(staff)
    detailed = [
        {'key': key, 'label': rbac.LABELS[key], 'group': rbac.KEY_GROUPS[key],
         'group_label': rbac.GROUP_LABELS[rbac.KEY_GROUPS[key]]}
        for key in keys
    ]
    return keys, detailed


def _grant(request, staff, kind, amr):
    """Hand over both cookies: the session the API reads, and the second factor."""
    codes = None
    if not staff.is_enrolled:
        codes, stored = _new_recovery_codes()
        staff.confirm_enrolment(stored)
    keys, detailed = _held_keys(staff)
    response = Response({
        'user': {
            'id': staff.user.pk,
            'username': staff.user.username,
            'name': staff.user.get_full_name() or staff.user.username,
            'email': staff.user.email,
        },
        'role': staff.effective_role,
        'permissions': keys,
        'permission_keys': detailed,
        'admin_expires_at': int((timezone.now() + ADMIN_TTL).timestamp()),
        'amr': list(amr),
        'recovery_codes': codes,
        'recovery_left': len(staff.recovery_codes),
        'enrolled': staff.is_enrolled,
    })
    set_auth_cookies(response, staff.user, device_id=f'admin:{kind}')
    set_admin_cookie(response, issue_admin_token(staff.user, amr=amr), kind='admin')
    response.delete_cookie(SETUP_COOKIE, path='/')
    staff.note_login_success()
    record(staff.user, 'admin_login', staff.user.username, f'{kind} via {amr[0]}')
    return response


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def admin_login(request):
    """Password check only. Nothing is handed out here without the second factor."""
    identifier = (request.data.get('username') or request.data.get('email') or '').strip().lower()
    password = request.data.get('password') or ''
    enforce(f'admin-login-ip:{client_ip(request)}', 8, 60)
    enforce(f'admin-login-id:{identifier}', 8, 60)
    if not identifier or not password:
        return Response({'detail': 'Enter the staff email or username and password.'}, status=400)

    user = User.objects.filter(username=identifier).first() or User.objects.filter(email=identifier).first()
    if not user or not user.is_staff or not user.check_password(password):
        # One sentence for both: whether this username is a staff account is not
        # something a password probe should be allowed to learn.
        return Response({'detail': 'Those credentials did not match a staff account.'}, status=401)
    if not user.is_active:
        return rbac.denial('staff_disabled', 'This account is deactivated.')

    staff = StaffAccount.for_user(user)
    if not staff.is_enabled:
        return rbac.denial('staff_disabled', 'Your access to the admin console has ended.')
    if staff.is_login_locked:
        return Response({
            'detail': f'Too many wrong passwords. Try again in {PASSWORD_LOCK_MINUTES} minutes.',
            'code': 'locked',
            'retry_in': int((staff.login_locked_until - timezone.now()).total_seconds()),
        }, status=423)
    if staff.is_locked:
        return Response({
            'detail': f'Too many wrong codes. Codes unlock again in {TOTP_LOCK_MINUTES} minutes.',
            'code': 'two_factor_locked',
            'retry_in': int((staff.totp_locked_until - timezone.now()).total_seconds()),
            'recovery_left': len(staff.recovery_codes),
        }, status=423)

    if not staff.is_enrolled:
        response = Response({
            'detail': 'Set up an authenticator app to finish signing in.',
            'code': 'two_factor_enrolment',
            'username': user.username,
            'totp': _enrolment_payload(staff),
        }, status=202)
        set_admin_cookie(response, issue_admin_token(user, kind='setup', ttl=SETUP_TTL), kind='setup')
        return response

    response = Response({
        'detail': 'Enter the six-digit code from your authenticator app.',
        'code': 'two_factor_required',
        'username': user.username,
        'recovery_left': len(staff.recovery_codes),
    }, status=202)
    set_admin_cookie(response, issue_admin_token(user, kind='setup', ttl=SETUP_TTL), kind='setup')
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def admin_verify(request):
    """Prove the second factor, either mid-sign-in or when the admin window lapsed.

    AllowAny is not an open door: this view *is* the second factor, and a browser
    that has not signed in yet arrives here anonymously. When it already holds a
    staff session cookie the default authenticator resolves it, which is what lets
    a lapsed 30-minute admin window be renewed from wherever the person was working.
    """
    code = (request.data.get('code') or '').strip()
    user = _principal(request)
    if user is None:
        return Response({'detail': 'Start the sign-in again.', 'code': 'session_expired'}, status=400)
    staff = StaffAccount.for_user(user)
    if not staff.is_enabled:
        return rbac.denial('staff_disabled', 'Your access to the admin console has ended.')
    if not code:
        return Response({'detail': 'Enter a code.', 'code': 'code_required'}, status=400)

    enforce(f'admin-code:{user.username}', 8, 300)
    if staff.is_locked:
        return Response({
            'detail': f'Too many wrong codes. Codes unlock again in {TOTP_LOCK_MINUTES} minutes.',
            'code': 'two_factor_locked',
            'retry_in': int((staff.totp_locked_until - timezone.now()).total_seconds()),
            'recovery_left': len(staff.recovery_codes),
        }, status=423)

    if staff.is_enrolled and totp.verify(staff.secret, code):
        staff.note_totp_success()
        return _grant(request, staff, 'verify', ('totp',))

    if staff.is_enrolled:
        wanted = hash_code(code.replace(' ', '').upper())
        for index, stored in enumerate(staff.recovery_codes):
            if secrets.compare_digest(stored, wanted):
                staff.burn_recovery(index)
                return _grant(request, staff, 'recovery', ('recovery',))

    if not staff.is_enrolled:
        # First enrolment: the code is the proof the authenticator is really set up.
        if totp.verify(staff.secret, code):
            return _grant(request, staff, 'enrol', ('totp',))

    staff.note_totp_failure()
    left = max(0, 5 - staff.totp_failed)
    return Response({
        'detail': 'That code is not valid right now.',
        'code': 'code_rejected',
        'attempts_left': left,
        'recovery_left': len(staff.recovery_codes),
    }, status=401)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only()
def admin_session(request):
    """Who is at the desk: role, effective keys, and when the window closes."""
    staff = request.staff_account
    payload = read_admin_token(request.COOKIES.get(ADMIN_COOKIE, ''))
    keys, detailed = _held_keys(staff)
    return Response({
        'user': {
            'id': staff.user.pk,
            'username': staff.user.username,
            'name': staff.user.get_full_name() or staff.user.username,
            'email': staff.user.email,
        },
        'role': staff.effective_role,
        'permissions': keys,
        # Labels for the keys this seat already holds, so "what can I open" needs
        # no catalogue read — that endpoint is a staff_view screen on purpose.
        'permission_keys': detailed,
        'enrolled': staff.is_enrolled,
        'recovery_left': len(staff.recovery_codes),
        'admin_expires_at': int(payload['exp']) if payload else None,
        'last_admin_login_at': staff.last_admin_login_at,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_logout(request):
    response = Response({'detail': 'Signed out.'})
    clear_auth_cookies(response)
    clear_admin_cookies(response)
    return response
