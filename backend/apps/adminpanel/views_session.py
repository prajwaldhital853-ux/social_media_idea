"""Signing in to the admin console: password first, authenticator code second.

The main site's `/api/auth/login/` is deliberately not reused and not modified. A
staff member browsing the platform as a person goes through that door; this door
only opens once an authenticator code has been proved, and the proof rides in a
cookie the browser discards when the tab closes — so the seat ends when the person
at it says so, not when a clock runs out.
"""

import logging
import random
import secrets
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.auth import REFRESH_TTL, clear_auth_cookies, hash_code, set_auth_cookies
from apps.accounts.models import EmailOTP, RefreshSession, User
from apps.accounts import passwords, safety
from apps.accounts.tasks import deliver_otp_email
from apps.common.emails import queue_event_email
from apps.common.ratelimit import client_ip, enforce

from . import rbac, totp
from .journal import record
from .models import StaffAccount, PASSWORD_LOCK_MINUTES, TOTP_LOCK_MINUTES
from .tokens import (
    ADMIN_COOKIE, SETUP_COOKIE, SETUP_TTL, clear_admin_cookies, issue_admin_token,
    read_admin_token, set_admin_cookie,
)

ISSUER = getattr(settings, 'ADMIN_2FA_ISSUER', 'Exposing')
RECOVERY_COUNT = 10
# A staff code is worth less time than a member's: the mailbox it lands in is the
# same mailbox that forwards to a hundred other services, and five minutes is
# still longer than anybody needs to read a six-digit number off their phone.
RECOVERY_MINUTES = 5
RECOVERY_MAX_ATTEMPTS = 5
RECOVERY_RESEND_SECONDS = 120
# One sentence for the seat, the member and the nobody. A sign-in screen that can
# tell you an address is not staff is a directory of who works here.
RECOVERY_SENT = 'If that email holds a staff seat, a code is on its way to it.'
# No I, O, L or 1: a code read aloud over the phone cannot be mistyped into a
# lockout.
_RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

logger = logging.getLogger(__name__)


def _address(value):
    """The one way this file reads an email off the wire — the same way signup does."""
    return (value or '').strip().lower()


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
        # None, not a countdown: this window is closed by the person at the desk,
        # by the tab, or by the machine — never by a clock they cannot see running.
        'admin_expires_at': None,
        'amr': list(amr),
        'recovery_codes': codes,
        'recovery_left': len(staff.recovery_codes),
        'enrolled': staff.is_enrolled,
    })
    set_auth_cookies(response, staff.user, device_id=f'admin:{kind}', access_ttl=REFRESH_TTL)
    set_admin_cookie(response, issue_admin_token(staff.user, amr=amr, ttl=None), kind='admin')
    response.delete_cookie(SETUP_COOKIE, path='/')
    staff.note_login_success()
    record(staff.user, 'admin_login', staff.user.username, f'{kind} via {amr[0]}')
    return response


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def admin_login(request):
    """Password check only. Nothing is handed out here without the second factor.

    The address and a password, nothing else. A username is short, public and
    changeable, and this is the one door on the platform that opens every desk —
    so it is closed to a string somebody could read off a profile or guess.
    """
    identifier = _address(request.data.get('email') or request.data.get('username'))
    password = request.data.get('password') or ''
    enforce(f'admin-login-ip:{client_ip(request)}', 8, 60)
    enforce(f'admin-login-id:{identifier}', 8, 60)
    if not identifier or not password:
        return Response({'detail': 'Enter the email on your seat and its password.'}, status=400)
    if '@' not in identifier:
        return Response({'detail': 'Staff sign in with their email address, not their username.'}, status=400)

    user = User.objects.filter(email=identifier).order_by('id').first()
    if not user or not user.is_staff or not user.check_password(password):
        # One sentence for both: whether this address is a staff account is not
        # something a password probe should be allowed to learn.
        return Response({'detail': 'Those credentials did not match a staff account.'}, status=401)
    if not user.is_active:
        return rbac.denial('staff_disabled', 'This account is deactivated.')
    if user.is_suspended:
        # rbac reads the same flag on every desk, but a suspended seat that types
        # the right password at this door deserves to be told why it will not open.
        return rbac.denial('staff_disabled', 'This staff account is suspended. A Superadmin can reinstate it.')

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

    if staff.must_change_password:
        # The console wrote this password, so nobody else may have kept it. The
        # seat is real and the door is not open until the person behind it has
        # replaced it with one only they know.
        response = Response({
            'detail': 'Choose your own password to finish signing in.',
            'code': 'password_change_required',
            'username': user.username,
        }, status=202)
        set_admin_cookie(response, issue_admin_token(user, kind='setup', ttl=SETUP_TTL), kind='setup')
        return response

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
def admin_set_password(request):
    """Replace the password the console handed out, then carry on to the code.

    Reaching this view already proves the first password: the setup cookie is only
    minted after a match. What it does not prove is that the person typing now is
    the person the seat was made for — which is exactly why the answer is a new
    secret and not the one that was read out to them.
    """
    user = _principal(request)
    if user is None:
        return Response({'detail': 'Start the sign-in again.', 'code': 'session_expired'}, status=400)
    staff = StaffAccount.for_user(user)
    if not staff.must_change_password:
        return Response({'detail': 'This seat already sets its own password.'}, status=400)

    password = str(request.data.get('password') or '')
    confirm = str(request.data.get('confirm') or '')
    enforce(f'admin-password:{user.email}', 5, 300)
    if confirm and confirm != password:
        return Response({'detail': 'The two passwords do not match.'}, status=400)
    if user.check_password(password):
        return Response({'detail': 'That is the password we gave you. Choose one only you know.'}, status=400)
    bad = passwords.refusal(password, user)
    if bad:
        return Response({'detail': bad, 'code': 'password_weak'}, status=400)

    user.set_password(password)
    user.save(update_fields=['password'])
    passwords.remember(user)
    staff.must_change_password = False
    staff.save(update_fields=['must_change_password'])
    record(user, 'staff_password_change', user.username, 'first password replaced at the door')

    if not staff.is_enrolled:
        return Response({
            'detail': 'Password set. Now set up an authenticator app to finish signing in.',
            'code': 'two_factor_enrolment',
            'username': user.username,
            'totp': _enrolment_payload(staff),
        }, status=202)
    return Response({
        'detail': 'Password set. Enter the six-digit code from your authenticator app.',
        'code': 'two_factor_required',
        'username': user.username,
        'recovery_left': len(staff.recovery_codes),
    }, status=202)


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
        'admin_expires_at': payload.get('exp') if payload else None,
        'last_admin_login_at': staff.last_admin_login_at,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_logout(request):
    response = Response({'detail': 'Signed out.'})
    clear_auth_cookies(response)
    clear_admin_cookies(response)
    return response


def _recovery_otp(user, device_id=''):
    """Mint a staff reset code, and retire the live one it replaces.

    Two open codes for one address would mean a person who asked twice has two
    chances to guess each, so the older letter is burned on the way out.
    """
    EmailOTP.objects.filter(user=user, purpose='admin_reset', consumed_at__isnull=True).update(
        consumed_at=timezone.now())
    code = f'{random.SystemRandom().randint(0, 999999):06d}'
    otp = EmailOTP.objects.create(
        user=user, purpose='admin_reset', code_hash=hash_code(code), device_id=device_id,
        expires_at=timezone.now() + timedelta(minutes=RECOVERY_MINUTES),
    )
    try:
        deliver_otp_email(user.email, code, 'admin_reset', RECOVERY_MINUTES)
    except Exception:  # noqa: BLE001 - the row is stored; the resend button is the fix
        logger.exception('Could not queue the staff reset code for %s', user.username)
    return otp, code


def _seat(user):
    """The seat behind an address, or None when there is nothing to recover."""
    staff = StaffAccount.objects.filter(user=user).first() if user else None
    if staff is None or not staff.is_enabled or not user.is_staff:
        return None
    if not user.is_active or user.is_suspended or not user.email:
        # A closed seat gets no letter: it cannot be signed in to even with a
        # fresh password, so sending one would only teach an attacker who is here.
        return None
    return staff


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def admin_forgot(request):
    """Step one at the console door: an address, then a code to that mailbox.

    A seat is not recovered through the member site's forgot-password page — that
    door opens one profile, this one opens every desk — so the code is written
    with its own purpose and can only ever be spent here.
    """
    email = _address(request.data.get('email'))
    enforce(f'admin-forgot-ip:{client_ip(request)}', 6, 600)
    enforce(f'admin-forgot:{email}', 3, 3600)
    if not email or '@' not in email:
        return Response({'detail': 'Enter the email address on your seat.'}, status=400)
    banned = safety.blocking(request, email)
    if banned is not None:
        return safety.refuse(banned)
    user = User.objects.filter(email=email).order_by('id').first()
    if _seat(user) is None:
        return Response({'detail': RECOVERY_SENT})
    otp, code = _recovery_otp(user, (request.data.get('device_id') or '')[:80])
    record(user, 'staff_recovery_sent', user.email, 'code mailed to the seat address')
    body = {
        'detail': RECOVERY_SENT,
        'challenge': otp.pk,
        'expires_in': RECOVERY_MINUTES * 60,
        'resend_in': RECOVERY_RESEND_SECONDS,
    }
    if settings.DEBUG or getattr(settings, 'EXPOSING_OTP_VISIBLE', False):
        body['dev_code'] = code
    return Response(body)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def admin_forgot_resend(request):
    """A second letter, but not for two minutes and not for free.

    The wait is counted on the server clock, so reloading the screen does not
    shorten it, and the cooldown is answered with the number of seconds left
    rather than a refusal the person has to time themselves.
    """
    challenge = request.data.get('challenge')
    enforce(f'admin-forgot-resend-ip:{client_ip(request)}', 6, 600)
    otp = EmailOTP.objects.filter(pk=challenge, purpose='admin_reset').select_related('user').first()
    if otp is None or _seat(otp.user) is None:
        return Response({'detail': RECOVERY_SENT})
    email = _address(otp.user.email)
    enforce(f'admin-forgot:{email}', 3, 3600)
    left = RECOVERY_RESEND_SECONDS - int((timezone.now() - otp.created_at).total_seconds())
    if left > 0:
        return Response({
            'detail': f'You can ask for another code in {left} seconds.',
            'retry_in': left, 'resend_in': left,
        }, status=429)
    new_otp, code = _recovery_otp(otp.user, otp.device_id)
    body = {
        'detail': RECOVERY_SENT,
        'challenge': new_otp.pk,
        'expires_in': RECOVERY_MINUTES * 60,
        'resend_in': RECOVERY_RESEND_SECONDS,
    }
    if settings.DEBUG or getattr(settings, 'EXPOSING_OTP_VISIBLE', False):
        body['dev_code'] = code
    return Response(body)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def admin_recovery(request):
    """Step two: the code, the new password, and every session this account held closed.

    The second factor survives this on purpose. A mailbox that has been taken over
    buys a password, and a password alone still cannot open the console — the
    authenticator code is what proves the phone is in the hand of the seat.
    """
    challenge = request.data.get('challenge')
    enforce(f'admin-recovery-ip:{client_ip(request)}', 10, 600)
    enforce(f'admin-recovery:{challenge}', 8, 600)
    hint = _address(request.data.get('email'))
    if hint:
        # Only worth an address-shaped bucket when the client names an address; an
        # anonymous key would pool every recovery on the platform into one limiter.
        enforce(f'admin-recovery-tries:{hint}', 12, 1800)
    otp = (EmailOTP.objects
           .filter(pk=challenge, purpose='admin_reset', consumed_at__isnull=True)
           .select_related('user').first())
    if otp is None or otp.expires_at < timezone.now():
        return Response({'detail': 'That code has expired. Ask for a new one.', 'code': 'code_expired'}, status=400)
    staff = _seat(otp.user)
    if staff is None:
        return rbac.denial('staff_disabled', 'That seat is closed.')
    if otp.attempts >= RECOVERY_MAX_ATTEMPTS:
        otp.consumed_at = timezone.now()
        otp.save(update_fields=['consumed_at'])
        return Response({'detail': 'Too many wrong codes. Ask for a new one.', 'code': 'code_rejected'}, status=400)
    code = str(request.data.get('code') or '').strip()
    if not code or not secrets.compare_digest(hash_code(code), otp.code_hash):
        otp.attempts += 1
        otp.save(update_fields=['attempts'])
        return Response({
            'detail': 'Wrong code.', 'code': 'code_rejected',
            'attempts_left': max(0, RECOVERY_MAX_ATTEMPTS - otp.attempts),
        }, status=400)

    user = otp.user
    password = str(request.data.get('password') or '')
    confirm = str(request.data.get('confirm') or '')
    if confirm and confirm != password:
        return Response({'detail': 'The two passwords do not match.'}, status=400)
    bad = passwords.refusal(password, user)
    if bad:
        # The code is not spent on a word the rules refuse: the letter is proved,
        # and the person holding it is being asked to fix their own typing.
        return Response({'detail': bad, 'code': 'password_weak'}, status=400)

    otp.consumed_at = timezone.now()
    otp.save(update_fields=['consumed_at'])
    user.set_password(password)
    user.failed_attempts = 0
    user.locked_until = None
    user.save(update_fields=['password', 'failed_attempts', 'locked_until'])
    passwords.remember(user)
    staff.must_change_password = False
    staff.login_failed = 0
    staff.login_locked_until = None
    staff.save(update_fields=['must_change_password', 'login_failed', 'login_locked_until'])
    safety.lift(user.email, reasons=['lock'])
    kicked = RefreshSession.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
    record(user, 'staff_password_reset', user.email, f'by emailed code; {kicked} session(s) closed')
    # Whoever held a session here is signed out, and the address is told about it:
    # a reset nobody announces is how an account change goes unnoticed for a week.
    queue_event_email(
        user.email, 'Your Exposing staff password changed', 'Your staff password changed',
        f'The password on the staff seat @{user.username} was reset with an emailed code. '
        f'{kicked} signed-in session(s) were closed. If this was not you, a Superadmin must revoke '
        'the seat before the next sign-in.',
    )
    response = Response({
        'detail': 'Password changed. Sign in with it and your authenticator code.',
        'sessions_revoked': kicked,
    })
    return clear_admin_cookies(response)
