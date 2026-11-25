"""The staff roster: who may open the console, at which role, with which keys.

Granting access makes a person `is_staff` in the main app, that is the flag every
existing admin endpoint already checks, and revoking it both switches the flag off
and revokes their refresh sessions, so the session in the browser dies at the next
call instead of lingering until the token expires.
"""

import re

from django.db.models import Count, Q
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts import passwords
from apps.accounts.models import RefreshSession, User

from . import rbac
from .journal import record
from .models import StaffAccount

ROLES = {choice for choice, _label in StaffAccount.Role.choices}
# The username is what the person types at the door, so it is checked here rather
# than trusted to a form in the console: dots and underscores only, and nothing
# that reads as two accounts when said out loud.
_USERNAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._]{2,29}$')
_SELF_EDIT = {
    'detail': 'Your own seat is edited by another staff account, so a bad click cannot lock you out.',
}
_LAST_CLIENT = {
    'detail': 'The Client needs at least one superadmin seat. Appoint one first.',
}
_NO_SEAT = {'detail': 'That account never held a seat.'}
# The literal sub-paths under the roster. They are not usernames, and a seat that
# reaches one of them on an API too old to own it must be told the API is old.
RESERVED = frozenset({'create', 'grant'})


def _row(staff):
    return {
        'username': staff.user.username,
        'name': staff.user.get_full_name() or staff.user.username,
        'email': staff.user.email,
        'role': staff.effective_role,
        'is_enabled': staff.is_enabled,
        'enrolled': staff.is_enrolled,
        'granted_keys': staff.granted_keys,
        'denied_keys': staff.denied_keys,
        'permissions': rbac.permissions_for(staff),
        'granted_by': staff.granted_by.username if staff.granted_by else None,
        'granted_at': staff.granted_at,
        'revoked_at': staff.revoked_at,
        'last_admin_login_at': staff.last_admin_login_at,
        'recovery_left': len(staff.recovery_codes),
        'codes_locked_until': staff.totp_locked_until,
        'must_change_password': staff.must_change_password,
    }


def _clean_keys(values, field):
    keys = []
    for value in values or []:
        key = str(value or '').strip()
        if key:
            keys.append(key)
    bad = [key for key in keys if key not in rbac.ALL_KEYS]
    if bad:
        raise ValueError(f'Unknown permission keys in {field}: {", ".join(bad)}')
    return sorted(set(keys))


def _superadmins_left(exclude_pk=None):
    rows = StaffAccount.objects.filter(is_enabled=True, user__is_superuser=True, user__is_active=True)
    if exclude_pk:
        rows = rows.exclude(pk=exclude_pk)
    return rows.count()


def user_role(user, staff=None):
    """The seat a person holds: the Client's own, or what the roster says."""
    if user.is_superuser:
        return StaffAccount.Role.SUPERADMIN
    return staff.role if staff else None


def _target(request, username):
    """(staff_row, caller, error_response) with the 6.1 role rules already applied.

    A Superadmin is the Client and moves only their own kind. An Admin reaches
    Moderator seats, including making and ending them, and nothing above. A
    Moderator reaches nobody.
    """
    caller = request.staff_account
    # `create` and `grant` are doors of their own, but they also sit under this
    # address. An API started before they landed resolves them here instead, and
    # the seat is then told a person called "create" does not exist.
    if username.lower() in RESERVED:
        return None, caller, Response(
            {'detail': 'This API does not have that staff door yet, restart it or deploy the '
                       'current build, then try again.'},
            status=409,
        )
    user = User.objects.filter(username__iexact=username).first()
    if user is None:
        return None, caller, Response({'detail': 'No such account.'}, status=404)
    staff = StaffAccount.objects.filter(user=user).first()
    target_role = user_role(user, staff)
    if target_role is not None and target_role not in rbac.MANAGEABLE[caller.effective_role]:
        return staff, caller, rbac.denial(
            'permission_required',
            f'A {caller.effective_role} may only manage Moderator seats.',
        )
    return staff, caller, None


def _editing_self(staff, caller):
    """Role and permission edits are made from another seat, never your own.

    One wrong click here would otherwise end the session making the change, and
    with it, any way back in. Switching a seat off is deliberately not covered:
    handing the console to a colleague is a real move, and `_superadmins_left`
    keeps the last Client seat standing.
    """
    return staff is not None and staff.user_id == caller.user_id


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('staff_view')
def staff_directory(request):
    rows = StaffAccount.objects.select_related('user', 'granted_by')
    query = (request.query_params.get('q') or '').strip()
    if query:
        # The box says name, username or email, so all three are searched. A seat
        # that knows a colleague as Sita should not have to remember the handle
        # they signed up with to find their row.
        rows = rows.filter(
            Q(user__username__icontains=query) | Q(user__email__icontains=query)
            | Q(user__first_name__icontains=query) | Q(user__last_name__icontains=query)
            | Q(user__profile__display_name__icontains=query)
        )
    state = request.query_params.get('status')
    if state == 'enabled':
        rows = rows.filter(is_enabled=True)
    elif state == 'revoked':
        rows = rows.filter(is_enabled=False)
    elif state == 'unenrolled':
        rows = rows.filter(totp_enrolled_at__isnull=True)
    return Response({
        'results': [_row(staff) for staff in rows.distinct().order_by('user__username')],
        # The roster chips are the seat's only warning that a colleague was given
        # a console and never enrolled, so each one carries its own number.
        'counts': StaffAccount.objects.aggregate(
            all=Count('pk'),
            enabled=Count('pk', filter=Q(is_enabled=True)),
            revoked=Count('pk', filter=Q(is_enabled=False)),
            unenrolled=Count('pk', filter=Q(totp_enrolled_at__isnull=True)),
        ),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('staff_grant')
def staff_grant(request):
    """Give an existing account a seat: role, optional extra keys, optional deny list."""
    username = (request.data.get('username') or '').strip()
    role = (request.data.get('role') or StaffAccount.Role.MODERATOR).strip()
    if not username:
        return Response({'detail': 'Choose the account by username.'}, status=400)
    if role not in ROLES:
        return Response({'detail': 'Choose superadmin, admin or moderator.'}, status=400)
    user = User.objects.filter(username__iexact=username).first()
    if user is None:
        return Response(
            {'detail': f'There is no @{username} on the platform. Somebody without an account '
                       'yet gets a seat from “A new staff account”, which writes the account too.'},
            status=404,
        )
    caller = request.staff_account
    existing, _caller, error = _target(request, username)
    if error is not None:
        return error
    if role not in rbac.MANAGEABLE[caller.effective_role]:
        return rbac.denial('permission_required', f'A {caller.effective_role} may only create Moderator seats.')
    if _editing_self(existing, caller) and user_role(user, existing) != role:
        return Response(_SELF_EDIT, status=400)
    try:
        granted_keys = _clean_keys(request.data.get('granted_keys'), 'granted_keys')
        denied_keys = _clean_keys(request.data.get('denied_keys'), 'denied_keys')
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=400)

    staff = StaffAccount.for_user(user)
    staff.role = role
    staff.is_enabled = True
    staff.revoked_at = None
    staff.granted_by = caller.user
    if role != rbac.SUPERADMIN:
        # A superadmin holds everything; storing grants on that seat would be a
        # second, contradicting answer to the same question.
        staff.granted_keys = granted_keys
        staff.denied_keys = denied_keys
    staff.save(update_fields=['role', 'is_enabled', 'revoked_at', 'granted_by', 'granted_keys', 'denied_keys'])
    if not user.is_staff:
        user.is_staff = True
        user.save(update_fields=['is_staff'])
    record(caller.user, 'grant_staff', user.username, f'role={role} grant={granted_keys} deny={denied_keys}')
    return Response(_row(staff))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('staff_grant')
def staff_create(request):
    """A seat for somebody with no account yet, written from the console.

    The Client used to have to sign up as a person first and be promoted
    afterwards, which meant a username taken by a spare account and a password
    the new colleague chose themselves. Here the seat names the person, picks
    their screens and writes the first password, and the flag on the row makes
    that password unusable past the door, because a credential read out over the
    phone or pasted into a chat is not a secret anybody should keep using.
    """
    data = request.data
    username = (data.get('username') or '').strip()
    name = (data.get('name') or '').strip()[:60]
    email = (data.get('email') or '').strip().lower()
    role = (data.get('role') or StaffAccount.Role.MODERATOR).strip()
    password = str(data.get('password') or '')

    if not _USERNAME.match(username):
        return Response({'detail': 'Use 3-30 letters, numbers, dots or underscores for the username.'}, status=400)
    if role not in ROLES:
        return Response({'detail': 'Choose superadmin, admin or moderator.'}, status=400)
    caller = request.staff_account
    if role not in rbac.MANAGEABLE[caller.effective_role]:
        return rbac.denial('permission_required', f'A {caller.effective_role} may only create Moderator seats.')
    if User.objects.filter(username__iexact=username).exists():
        return Response({'detail': f'The username {username} is already taken on the platform.'}, status=409)
    # The address is not a nicety. Staff sign in with it and nothing else, and it
    # is the only way back for a seat that has lost its password, a seat without
    # one can only be repaired by somebody else's hand.
    if not email:
        return Response({'detail': 'A seat needs an email address: it is what signs the person in '
                                   'and the only way they recover a lost password.'}, status=400)
    try:
        validate_email(email)
    except DjangoValidationError:
        return Response({'detail': 'That is not an email address.'}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return Response({'detail': 'That email address already belongs to an account.'}, status=409)
    bad = passwords.strength(password)
    if bad:
        return Response({'detail': bad}, status=400)

    user = User.objects.create(
        username=username, email=email, first_name=name,
        is_staff=True, is_active=True, provider='email',
    )
    user.set_password(password)
    user.save(update_fields=['password'])
    passwords.remember(user)

    staff = StaffAccount.for_user(user)
    staff.role = role
    staff.is_enabled = True
    staff.revoked_at = None
    staff.granted_by = caller.user
    staff.must_change_password = True
    if role != rbac.SUPERADMIN:
        try:
            staff.granted_keys = _clean_keys(data.get('granted_keys'), 'granted_keys')
            staff.denied_keys = _clean_keys(data.get('denied_keys'), 'denied_keys')
        except ValueError as exc:
            user.delete()
            return Response({'detail': str(exc)}, status=400)
    staff.save(update_fields=['role', 'is_enabled', 'revoked_at', 'granted_by',
                              'must_change_password', 'granted_keys', 'denied_keys'])
    record(caller.user, 'create_staff', user.username,
           f'role={role} password issued, must be replaced at first sign-in')
    out = _row(staff)
    out['detail'] = (f'{user.username} holds a {role} seat. Give them this password once, the '
                     'console will make them choose their own before it opens.')
    return Response(out, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('staff_permissions')
def staff_update(request, username):
    """Change a seat: role, enable/disable, or the moderator's own grant and deny lists."""
    staff, caller, error = _target(request, username)
    if error is not None:
        return error
    if staff is None:
        return Response(_NO_SEAT, status=400)
    data = request.data
    if _editing_self(staff, caller) and any(field in data for field in ('role', 'granted_keys', 'denied_keys')):
        return Response(_SELF_EDIT, status=400)
    fields = []

    if 'role' in data:
        role = (data.get('role') or '').strip()
        if role not in ROLES:
            return Response({'detail': 'Choose superadmin, admin or moderator.'}, status=400)
        if role not in rbac.MANAGEABLE[caller.effective_role]:
            return rbac.denial('permission_required', f'A {caller.effective_role} cannot set that role.')
        if staff.effective_role == rbac.SUPERADMIN and role != rbac.SUPERADMIN and _superadmins_left(staff.pk) == 0:
            return Response(_LAST_CLIENT, status=400)
        staff.role = role
        fields.append('role')

    if 'is_enabled' in data:
        enabled = bool(data.get('is_enabled'))
        if not enabled and staff.effective_role == rbac.SUPERADMIN and _superadmins_left(staff.pk) == 0:
            return Response(_LAST_CLIENT, status=400)
        staff.is_enabled = enabled
        staff.revoked_at = None if enabled else timezone.now()
        fields += ['is_enabled', 'revoked_at']

    for field in ('granted_keys', 'denied_keys'):
        if field in data:
            if staff.effective_role == rbac.SUPERADMIN:
                return Response({'detail': 'A superadmin already holds every permission.'}, status=400)
            try:
                setattr(staff, field, _clean_keys(data.get(field), field))
            except ValueError as exc:
                return Response({'detail': str(exc)}, status=400)
            fields.append(field)

    if not fields:
        return Response({'detail': 'Nothing to change.'}, status=400)
    staff.save(update_fields=fields)
    if not staff.is_enabled and staff.user.is_staff:
        # Turning a seat off is also taking the console away in the main app,
        # where the same `is_staff` flag opens the admin endpoints.
        staff.user.is_staff = False
        staff.user.save(update_fields=['is_staff'])
        RefreshSession.objects.filter(user=staff.user).update(revoked_at=timezone.now())
    if staff.is_enabled and not staff.user.is_staff:
        # The mirror of it: a seat handed back has to reach the door again, or
        # the console says "can sign in again" over a door still shut.
        staff.user.is_staff = True
        staff.user.save(update_fields=['is_staff'])
    record(caller.user, 'update_staff', staff.user.username, ', '.join(fields))
    return Response(_row(staff))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('staff_grant')
def staff_revoke(request, username):
    staff, caller, error = _target(request, username)
    if error is not None:
        return error
    if staff is None:
        return Response(_NO_SEAT, status=400)
    if staff.effective_role == rbac.SUPERADMIN and _superadmins_left(staff.pk) == 0:
        return Response(_LAST_CLIENT, status=400)
    staff.is_enabled = False
    staff.revoked_at = timezone.now()
    staff.save(update_fields=['is_enabled', 'revoked_at'])
    if staff.user.is_staff:
        staff.user.is_staff = False
        staff.user.save(update_fields=['is_staff'])
    RefreshSession.objects.filter(user=staff.user).update(revoked_at=timezone.now())
    record(caller.user, 'revoke_staff', username, 'access ended')
    return Response(_row(staff))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('staff_permissions')
def staff_reset_two_factor(request, username):
    """A lost phone: the authenticator is unbound and must be enrolled again.

    The seat survives; the second factor does not, so nobody can sign in as this
    person with a stale secret while they set a new one up.
    """
    staff, caller, error = _target(request, username)
    if error is not None:
        return error
    if staff is None:
        return Response(_NO_SEAT, status=400)
    staff.totp_secret = ''
    staff.totp_enrolled_at = None
    staff.recovery_codes = []
    staff.totp_failed = 0
    staff.totp_locked_until = None
    staff.save(update_fields=['totp_secret', 'totp_enrolled_at', 'recovery_codes', 'totp_failed', 'totp_locked_until'])
    RefreshSession.objects.filter(user=staff.user).update(revoked_at=timezone.now())
    record(caller.user, 'reset_staff_two_factor', username, 'authenticator unbound')
    return Response({'detail': 'They will be asked to set up an authenticator at the next sign-in.', 'username': username})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('staff_view')
def permission_catalog(request):
    return Response({'groups': rbac.groups(), 'permissions': rbac.catalogue()})
