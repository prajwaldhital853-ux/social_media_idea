import logging
import random
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
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
from . import passwords, safety
from .tasks import deliver_otp_email

LOCK_THRESHOLD = 3
# A cooloff, not a lockout that needs a rescue email: it expires by itself.
LOCK_MINUTES = 5
OTP_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
# A reset code is the one letter worth waiting for: two minutes between sends, so
# a scripted address cannot use the mailer as a firehose, and the counter is shown
# rather than guessed at by the client.
RESEND_SECONDS = 120
# The window between proving the code and choosing the password. Long enough to
# type twice, short enough that an abandoned reset is not a standing invitation.
RESET_TICKET_SECONDS = 900
RESET_TICKET_SALT = 'accounts.reset'
# A refresh call lives at most TIMEOUT_MS (12s on the client) in flight, so two
# tabs racing each other are this close together; anything presenting a retired
# token later than that is not the same browser finishing a request.
ROTATION_GRACE = timedelta(seconds=15)

logger = logging.getLogger(__name__)


def _email(value):
    """The one way this file reads an address off the wire.

    Signup, sign-in and unlock all have to agree on it: 'me@X.com ' from one form
    and 'me@x.com' from the next is the account that 'disappeared'.
    """
    return (value or '').strip().lower()


def _device_id(request):
    return (request.data.get('device_id') or request.META.get('HTTP_X_DEVICE_ID') or '')[:80]


def _suspended(user):
    """The one answer every door gives a suspended account.

    It used to read `Account suspended: <whatever the seat typed>`, which is a
    note from the moderation log rather than a sentence to the person standing at
    the door. They are told what happened, what it costs them, when it ends, and
    that the sentence came from a staff account they can reply to.
    """
    reason = (user.suspend_reason or '').strip()
    ends = user.suspended_until
    until = ''
    if ends:
        if ends.year >= 9999:
            until = 'It has no end date.'
        else:
            until = f'It ends on {ends.strftime("%d %B %Y")}.'
    detail = 'Your account is suspended, so you cannot sign in.'
    if reason:
        detail += f' The reason given: {reason}.'
    if until:
        detail += f' {until}'
    detail += ' Ask the Exposing team about this from another account, or wait until it ends.'
    return Response({
        'detail': detail,
        'suspended': True,
        'suspended_until': ends,
        'permanent': bool(ends and ends.year >= 9999),
    }, status=403)


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
    try:
        deliver_otp_email(user.email, code, purpose)
    except Exception:
        # The code is already stored, so a broker, mail provider or exhausted
        # process that is down costs an email, never a sign-in.
        logger.exception('Could not queue the %s code for %s', purpose, user.username)
    return otp, code


def _media_key(url):
    """The MediaBlob key inside a stored media url, or '' for an outside file."""
    marker = '/media/'
    text = url or ''
    if marker not in text:
        return ''
    return text.split(marker, 1)[1].split('?', 1)[0]


def _purge_media(user):
    """Delete the pictures this account uploaded before the row that names them.

    Cascades cover every table that points at the user, but an upload's key has
    no owner column, so the urls have to be collected while the profile and the
    posts are still there.
    """
    from apps.common.models import MediaBlob

    urls = []
    profile = getattr(user, 'profile', None)
    if profile:
        urls += [profile.avatar_url, profile.cover_url]
    urls += list(user.posts.values_list('media__url', flat=True))
    urls += list(user.listings.values_list('images__url', flat=True))
    keys = {_media_key(url) for url in urls}
    keys.discard('')
    if keys:
        MediaBlob.objects.filter(key__in=keys).delete()


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
    user.last_ip = client_ip(request)[:60]
    user.last_device = (device_id or '')[:80]
    user.save(update_fields=['failed_attempts', 'locked_until', 'last_ip', 'last_device'])
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
    email = _email(data.get('email'))
    password = data.get('password') or ''
    name = (data.get('name') or '').strip()
    google = data.get('google') or {}
    if not username or not username.replace('_', '').replace('.', '').isalnum() or not 3 <= len(username) <= 30:
        return Response({'detail': 'Username must be 3-30 letters, numbers, dots or underscores.'}, status=400)
    try:
        validate_email(email)
    except DjangoValidationError:
        return Response({'detail': 'Enter a valid email address.'}, status=400)
    # A new account is the widest door of the three, so a connection or a browser
    # that was closed for guessing passwords cannot simply start over. The address
    # is read too: the lock that covers it says so here instead of pretending the
    # email is merely taken.
    banned = safety.blocking(request, email)
    if banned is not None:
        return safety.refuse(banned)
    if User.objects.filter(username=username).exists():
        return Response({'detail': 'That username is taken.'}, status=400)
    if User.objects.filter(email=email).exists():
        return Response({'detail': 'An account with that email already exists.'}, status=400)
    if not google:
        bad = passwords.strength(password)
        if bad:
            return Response({'detail': bad}, status=400)
    dob = data.get('dob') or None
    country = (data.get('country') or '').strip()[:80]
    if not dob or not country:
        return Response({'detail': 'Date of birth and country are required.'}, status=400)
    device_id = _device_id(request)
    # The account, its profile and its wallet either all exist or none of them do.
    # Written across three commits, a request that died in the middle left an
    # address that claimed to be taken while no usable member stood behind it.
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=username, email=email, password=password if not google else None,
                first_name=name.split()[0] if name else '', last_name=' '.join(name.split()[1:]) if name else '',
                date_of_birth=dob, country=country, city=(data.get('city') or '').strip()[:80],
                provider='google' if google else 'email',
            )
            if google:
                # A Google address is already proved by the identity provider.
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
    except IntegrityError:
        # Two tabs, one address: the exists() checks above both said no.
        return Response({'detail': 'An account with that email already exists.'}, status=400)
    passwords.remember(user)
    if google:
        _trust_device(user, device_id)
        resp = Response({'user': {'id': user.pk, 'username': user.username, 'email': user.email}},
                        status=status.HTTP_201_CREATED)
        return set_auth_cookies(resp, user, device_id)
    otp, code = _make_otp(user, 'verify', device_id)
    # An emailed address is not proved yet, so the body carries only the challenge:
    # handing out cookies here would give every unverified signup a live session.
    return Response(_otp_response(otp, code), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def login(request):
    ip = client_ip(request)
    # This counter only refuses a flood from one address; the credential defence
    # is the three-try lock below and the per-account cap after it. At five per
    # minute a household behind one router, or anyone who mistypes twice and
    # reloads, gets refused before the lock has anything to say.
    enforce(f'login-ip:{ip}', 10, 60)
    # Email and a password, nothing else. A handle is public, other members can
    # read it off a profile, and it is changeable — accepting it here meant two
    # different strings could reach two different rows, and the wrong-password
    # answer never says which one it tried.
    email = _email(request.data.get('email'))
    if not email:
        return Response({'detail': 'Enter your email address.'}, status=400)
    if '@' not in email:
        return Response({'detail': 'Sign in with your email address, not your username.'}, status=400)
    enforce(f'login-id:{email}', 10, 60)
    password = request.data.get('password') or ''
    user = User.objects.filter(email=email).order_by('id').first()
    if not user:
        return Response({'detail': 'No account matches those credentials.'}, status=401)
    if user.is_suspended:
        return _suspended(user)
    if user.locked_until and not user.is_locked:
        # The cooloff elapsed, so the next three passwords are the owner's again.
        user.locked_until = None
        user.failed_attempts = 0
        user.save(update_fields=['locked_until', 'failed_attempts'])
    if user.is_locked:
        return Response({
            'detail': f'Too many wrong passwords. Try again in {LOCK_MINUTES} minutes.',
            'locked': True, 'locked_until': user.locked_until,
            'retry_in': int((user.locked_until - timezone.now()).total_seconds()),
        }, status=423)
    if not user.has_usable_password():
        # A Google account was created with password=None, so nothing was ever
        # hashed here. The visitor knows their Gmail password and it is the right
        # password for the wrong system — calling that "wrong" and burning one of
        # the three tries would lock the owner out of the only door that opens.
        return Response({
            'detail': 'This account was created with Google and has no password here. '
                      'Continue with Google, or set a password with Forgot password.',
            'google_only': True,
        }, status=401)
    encoded = user.password
    if not user.check_password(password):
        user.failed_attempts += 1
        if user.failed_attempts >= LOCK_THRESHOLD:
            # The cooloff itself is only worth anything if the doors beside it shut
            # at the same time: the address, this connection and this browser are
            # banned for exactly as long as the account stays locked.
            minutes, until = safety.trip(request, user)
            user.save(update_fields=['failed_attempts'])
            return Response({
                'detail': f'Account locked for {minutes} minutes after {LOCK_THRESHOLD} wrong passwords.',
                'locked': True, 'locked_until': until, 'retry_in': minutes * 60, 'scope': 'email',
            }, status=423)
        user.save(update_fields=['failed_attempts'])
        return Response({
            'detail': 'Wrong password.', 'attempts_left': LOCK_THRESHOLD - user.failed_attempts,
        }, status=401)
    # The password is right, so the cooloff this address caused stops holding its
    # side doors shut: a household must not lose the honest member's sign-in to
    # somebody else's guessing. A staff ban is not lifted by a password.
    safety.lift(user.email, reasons=['lock'])
    banned = safety.blocking(request, email)
    if banned is not None:
        return safety.refuse(banned)
    if user.password != encoded:
        # The verify re-hashed at the current work factor. An upgrade nobody
        # writes down is paid for again on every later sign-in.
        user.save(update_fields=['password'])
    device_id = _device_id(request)
    if not user.email_verified:
        # The password is right and the account is real; it was simply never
        # confirmed. Say which of the three it is, and hand back a live code with
        # the resend path, instead of letting this look like a wrong password.
        otp, code = _make_otp(user, 'verify', device_id)
        return Response({
            'detail': 'That email address is not verified yet. We sent a new code to it.',
            'email_not_verified': True, 'email_hint': user.email, **_otp_response(otp, code),
        }, status=status.HTTP_403_FORBIDDEN)
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
    if otp.purpose == 'delete':
        # The row goes first, then the pictures it pointed at: a cascade cannot
        # reach MediaBlob, and a blob left behind is somebody's face in a table
        # nobody can see it from.
        _purge_media(user)
        user.delete()
        response = Response({'detail': 'Your account and all of its data have been deleted.'})
        return clear_auth_cookies(response)
    if otp.purpose == 'unlock':
        user.failed_attempts = 0
        user.locked_until = None
        user.save(update_fields=['failed_attempts', 'locked_until'])
        # The code went to the address, which is the proof that the person on the
        # other side owns it — so the connection and the browser that trip closed
        # open again with it. Staff bans survive an unlock.
        safety.lift(user.email, reasons=['lock'])
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
    if otp.purpose == 'reset':
        # Two minutes from the send that is still live, counted on the server clock
        # so a reload cannot shorten it.
        left = RESEND_SECONDS - int((timezone.now() - otp.created_at).total_seconds())
        if left > 0:
            return Response({
                'detail': f'You can ask for another code in {left} seconds.',
                'retry_in': left, 'resend_in': left,
            }, status=429)
    new_otp, code = _make_otp(otp.user, otp.purpose, otp.device_id)
    body = _otp_response(new_otp, code)
    if otp.purpose == 'reset':
        body['resend_in'] = RESEND_SECONDS
    return Response(body)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def refresh(request):
    enforce(f'refresh:{client_ip(request)}', 30, 60)
    token = request.COOKIES.get('exposing_refresh')
    if not token:
        return Response({'detail': 'No refresh token.'}, status=401)
    payload = decode_token(token, 'refresh')
    session = RefreshSession.objects.filter(jti=payload['jti']).select_related('user').first()
    if not session or session.expires_at < timezone.now():
        return Response({'detail': 'Session revoked or expired. Sign in again.'}, status=401)
    if session.revoked_at:
        # Rotation retires the row it consumed, so a second tab whose request was
        # already in flight presents the token the first tab just replaced. That
        # tab is the same browser on the same device, and signing it out would end
        # a session the user never asked to end. A lock-out or a sign-out leaves
        # no live sibling behind, so it stays fatal.
        now = timezone.now()
        if now - session.revoked_at > ROTATION_GRACE:
            return Response({'detail': 'Session revoked or expired. Sign in again.'}, status=401)
        session = RefreshSession.objects.filter(
            user=session.user, device_id=session.device_id, revoked_at__isnull=True,
            expires_at__gt=now, created_at__gte=session.revoked_at - ROTATION_GRACE,
        ).order_by('-created_at').first()
        if not session:
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
    email = _email(request.data.get('email'))
    enforce(f'unlock:{email}', 3, 600)
    if not email or '@' not in email:
        return Response({'detail': 'Enter the email address you signed up with.'}, status=400)
    user = User.objects.filter(email=email).order_by('id').first()
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
def reset_request(request):
    """Step one of a password reset: the address, then a code to it.

    The answer is the same whether the account exists or not — a form that says
    "no such member" is a directory. What differs is only whether a letter goes out.
    """
    email = _email(request.data.get('email'))
    enforce(f'reset-ip:{client_ip(request)}', 8, 600)
    enforce(f'reset:{email}', 3, 3600)
    if not email or '@' not in email:
        return Response({'detail': 'Enter the email address you signed up with.'}, status=400)
    # A guesser who is locked out is not handed a second door out of the mailbag.
    banned = safety.blocking(request, email)
    if banned is not None:
        return safety.refuse(banned)
    user = User.objects.filter(email=email).order_by('id').first()
    if not user or user.is_suspended:
        return Response({'detail': 'If that email has an account, a reset code is on its way.'})
    if user.is_staff:
        # A seat opens every desk on the platform, so it is not recovered through
        # the door meant for one member's own profile. The console screen says the
        # same thing back, and that is where the letter has to be asked for.
        return Response({
            'detail': 'This is a staff account. Reset it from “Forgot password” on the admin console sign-in.',
            'staff_door': True,
        }, status=400)
    otp, code = _make_otp(user, 'reset', _device_id(request))
    return Response({
        'detail': 'If that email has an account, a reset code is on its way.',
        'resend_in': RESEND_SECONDS, **_otp_response(otp, code),
    })


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def reset_verify(request):
    """The code on its own, which buys the right to choose a password.

    Splitting the proof from the change is what lets the screen ask for one thing
    at a time, and it keeps the code out of the call that actually writes a
    password — that one carries a signed ticket instead.
    """
    challenge = request.data.get('challenge')
    enforce(f'reset-verify:{challenge}', 10, 600)
    otp = EmailOTP.objects.filter(pk=challenge, purpose='reset', consumed_at__isnull=True).select_related('user').first()
    if not otp or otp.expires_at < timezone.now():
        return Response({'detail': 'Code expired. Request a new one.'}, status=400)
    if otp.attempts >= OTP_MAX_ATTEMPTS:
        otp.consumed_at = timezone.now()
        otp.save(update_fields=['consumed_at'])
        return Response({'detail': 'Too many wrong codes. Request a new one.'}, status=400)
    if hash_code(str(request.data.get('code') or '')) != otp.code_hash:
        otp.attempts += 1
        otp.save(update_fields=['attempts'])
        return Response({'detail': 'Wrong code.', 'attempts_left': OTP_MAX_ATTEMPTS - otp.attempts}, status=400)
    return Response({
        'verified': True,
        'detail': 'Code confirmed. Choose a new password.',
        'ticket': signing.dumps({'otp': otp.pk, 'user': otp.user_id}, salt=RESET_TICKET_SALT),
        'ticket_in': RESET_TICKET_SECONDS,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def reset_confirm(request):
    """Step three: the new password, spent against the ticket the code earned.

    Whoever was guessing has had the address proved against them, so the row keeps
    its history — but no session they had already opened survives this call.
    """
    challenge = request.data.get('challenge')
    email_hint = _email(request.data.get('email'))
    # Only worth an address-shaped bucket when the client names an address; an
    # anonymous key would pool every reset in the world into one limiter.
    if email_hint:
        enforce(f'reset-tries:{email_hint}', 15, 1800)
    try:
        payload = signing.loads(str(request.data.get('ticket') or ''), salt=RESET_TICKET_SALT, max_age=RESET_TICKET_SECONDS)
    except signing.BadSignature:
        payload = None
    if not payload or str(payload.get('otp')) != str(challenge):
        return Response({'detail': 'Confirm the code first.'}, status=400)
    otp = EmailOTP.objects.filter(pk=challenge, purpose='reset', consumed_at__isnull=True).select_related('user').first()
    if not otp:
        return Response({'detail': 'Code expired. Request a new one.'}, status=400)
    password = str(request.data.get('password') or '')
    bad = passwords.refusal(password, otp.user)
    if bad:
        # The code is not spent on a weak password: the person fixing the word
        # should not have to wait two minutes for a letter they already hold.
        return Response({'detail': bad}, status=400)
    otp.consumed_at = timezone.now()
    otp.save(update_fields=['consumed_at'])
    user = otp.user
    user.set_password(password)
    # The code arrived at the address, which is the proof the signup form asks for.
    user.email_verified = True
    user.failed_attempts = 0
    user.locked_until = None
    user.save(update_fields=['password', 'email_verified', 'failed_attempts', 'locked_until'])
    passwords.remember(user)
    safety.lift(user.email, reasons=['lock'])
    now = timezone.now()
    kicked = RefreshSession.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=now)
    return Response({
        'detail': 'Password changed. Sign in with the new one.',
        'sessions_revoked': kicked,
        'password_changed': True,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def account_delete_request(request):
    """Step one of a deletion: the word, then a code to the address on file.

    The typed word is checked here rather than in the browser so a stray POST
    cannot start the clock on somebody's account.
    """
    enforce(f'account-delete:{request.user.pk}', 5, 600)
    if str(request.data.get('confirm') or '').strip().upper() != 'DELETE':
        return Response({'detail': 'Type DELETE to confirm.'}, status=400)
    otp, code = _make_otp(request.user, 'delete')
    return Response({'detail': 'A deletion code is on its way to your email.', **_otp_response(otp, code)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def account_delete_confirm(request):
    return _verify_otp(request, force_purpose='delete')


GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
GOOGLE_CERTS_TTL = 3600


def _google_claims(token, client_id):
    """Verified claims from a Google ID token, or None.

    Google's keys are cached and read out of that cache rather than fetched again
    by a client library: this used to make two HTTPS calls per sign-in and the
    second had no timeout, so Google being slow was indistinguishable from the
    button doing nothing. A `kid` missing from the cache means the key rotated,
    which earns exactly one refetch.
    """
    import json
    import urllib.request

    import jwt as pyjwt
    from django.core.cache import cache
    from jwt import PyJWK

    def fetch():
        with urllib.request.urlopen(GOOGLE_CERTS_URL, timeout=5) as response:
            keys = json.load(response)
        cache.set('google-jwks', keys, GOOGLE_CERTS_TTL)
        return keys

    try:
        kid = pyjwt.get_unverified_header(token).get('kid', '')
        keys = cache.get('google-jwks') or fetch()
        jwk = next((k for k in keys.get('keys', []) if k.get('kid') == kid), None)
        if jwk is None:
            keys = fetch()
            jwk = next((k for k in keys.get('keys', []) if k.get('kid') == kid), None)
        if jwk is None:
            return None
        return pyjwt.decode(
            token, PyJWK(jwk).key, algorithms=['RS256'],
            audience=client_id, issuer='https://accounts.google.com',
        )
    except Exception:
        # A token we cannot check is a refusal, never a login. What went wrong is
        # in the log, which the visitor cannot read and the request id points at.
        logger.exception('Google token verification failed')
        return None


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def google(request):
    enforce(f'google:{client_ip(request)}', 10, 60)
    data = request.data
    client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
    if client_id:
        claims = _google_claims(data.get('id_token') or '', client_id)
        if claims is None:
            return Response({'detail': 'Google token verification failed.'}, status=401)
        email, name, sub = _email(claims.get('email')), (claims.get('name') or '').strip(), claims.get('sub', '')
    else:
        if not settings.DEBUG:
            # The demo branch believes whatever identity the client claims, so it exists
            # for local QA only — production must verify a real Google token.
            return Response({'detail': 'Google sign-in is not configured on this server.'}, status=503)
        demo = data.get('demo') or {}
        email, name, sub = _email(demo.get('email')), (demo.get('name') or '').strip(), demo.get('sub') or ''
        if not email or not sub:
            return Response({'detail': 'Google sign-in is not configured on this server.'}, status=503)
    if not email:
        # Blank would otherwise match the one row an admin left without an address.
        return Response({'detail': 'Google did not give us an email address for this account.'}, status=400)
    # Google proves who the address belongs to; it never proved that the account
    # behind it is allowed in. A locked or banned identity used to walk through here
    # and _finish_login wiped its own counter on the way.
    banned = safety.blocking(request, email)
    if banned is not None:
        return safety.refuse(banned)
    user = User.objects.filter(email=email).order_by('id').first()
    device_id = _device_id(request)
    if user:
        if user.is_suspended:
            # The identity provider proved the address and nothing else: a
            # suspended account is still suspended when it arrives through
            # Google, and it deserves to be told so in one plain sentence.
            return _suspended(user)
        if user.is_locked:
            return Response({
                'detail': 'This account is locked after too many wrong passwords. '
                          'Sign in with the right password once the cooloff ends.',
                'locked': True, 'locked_until': user.locked_until, 'scope': 'email',
                'retry_in': int((user.locked_until - timezone.now()).total_seconds()),
            }, status=423)
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