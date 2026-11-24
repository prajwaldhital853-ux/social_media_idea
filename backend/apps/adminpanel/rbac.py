"""Role-based access control for the admin console (contract 6.1).

Three roles, one catalogue. A Superadmin is the Client and holds every key. An
Admin holds every screen the contract lists for staff — settings, users, the
staff roster, Coin Requests, Coin and Promotion settings — but may only change
roster rows at Moderator level, so an Admin can never promote a peer or evict
the Client. A Moderator holds reports, content, listings, warning notices and
user actions; the Coin and payment keys exist for them only when a Superadmin or
Admin grants them explicitly.

The catalogue is data, not code: the dashboard renders its toggles from
`/api/admin/permissions/`, so a new screen later asks for one more key here
instead of a new branch in a component.
"""

from functools import wraps

from rest_framework.response import Response

from .models import StaffAccount
from .tokens import ADMIN_COOKIE, read_admin_token

SUPERADMIN = StaffAccount.Role.SUPERADMIN
ADMIN = StaffAccount.Role.ADMIN
MODERATOR = StaffAccount.Role.MODERATOR

GROUPS = (
    ('dashboard', 'Dashboard'),
    ('moderation', 'Moderation'),
    ('people', 'People'),
    ('payments', 'Coins and payments'),
    ('promotions', 'Promotions'),
    ('safety', 'Safety and audit'),
    ('platform', 'Platform settings'),
    ('staff', 'Staff'),
)

# key, label, group, roles holding it by default.
CATALOG = (
    ('overview', 'Live statistics and analytics', 'dashboard', (ADMIN, MODERATOR)),
    ('reports', 'Report queue', 'moderation', (ADMIN, MODERATOR)),
    ('content', 'Post and comment review', 'moderation', (ADMIN, MODERATOR)),
    ('listings', 'Marketplace listing review', 'moderation', (ADMIN, MODERATOR)),
    ('notices', 'Public warning notices', 'moderation', (ADMIN, MODERATOR)),
    ('users', 'User directory and search', 'people', (ADMIN, MODERATOR)),
    ('user_actions', 'Suspend, reinstate, verify, delete', 'people', (ADMIN, MODERATOR)),
    ('warnings', 'Private warnings to users', 'people', (ADMIN, MODERATOR)),
    ('coins_view', 'Coin request queue', 'payments', (ADMIN,)),
    ('coins_review', 'Approve, reject or question requests', 'payments', (ADMIN,)),
    ('coin_ledger', 'Coin ledger and manual adjustments', 'payments', (ADMIN,)),
    ('coin_settings', 'Coin price, limits, bank, retention', 'payments', (ADMIN,)),
    ('promotions_view', 'Promotion queue and performance', 'promotions', (ADMIN,)),
    ('promotions_review', 'Approve, pause, stop, refund', 'promotions', (ADMIN,)),
    ('promotion_packages', 'Promotion packages and pricing', 'promotions', (ADMIN,)),
    ('promotion_algorithm', 'Targeting weights, caps, global pause', 'promotions', (ADMIN,)),
    ('spam_settings', 'Rate limits, blocked words, auto-hide', 'safety', (ADMIN,)),
    ('alerts', 'Automated alerts and thresholds', 'safety', (ADMIN,)),
    ('audit', 'Staff audit log', 'safety', (ADMIN,)),
    ('exports', 'CSV exports', 'safety', (ADMIN,)),
    ('platform_settings', 'Platform settings', 'platform', (ADMIN,)),
    ('welcome_text', 'Welcome message, tagline, contacts', 'platform', (ADMIN,)),
    ('post_limits', 'Default post limits', 'platform', (ADMIN,)),
    ('categories', 'Marketplace categories', 'platform', (ADMIN,)),
    ('blocked_words', 'Prohibited items and blocked words', 'platform', (ADMIN,)),
    ('staff_view', 'Staff roster', 'staff', (ADMIN,)),
    ('staff_grant', 'Grant or revoke staff access', 'staff', (ADMIN,)),
    ('staff_permissions', 'Per-moderator permission grants', 'staff', (ADMIN,)),
)

ALL_KEYS = tuple(key for key, _label, _group, _roles in CATALOG)
LABELS = {key: label for key, label, _group, _roles in CATALOG}
KEY_GROUPS = {key: group for key, _label, group, _roles in CATALOG}
GROUP_LABELS = dict(GROUPS)
ROLE_DEFAULTS = {
    role: frozenset(key for key, _label, _group, roles in CATALOG if role in roles)
    for role in (SUPERADMIN, ADMIN, MODERATOR)
}
# What a caller holding each key is allowed to do to a roster row of each role.
MANAGEABLE = {
    SUPERADMIN: {SUPERADMIN, ADMIN, MODERATOR},
    ADMIN: {MODERATOR},
    MODERATOR: set(),
}


def permissions_for(staff):
    """The effective key list: role defaults, plus grants, with denials winning."""
    role = staff.effective_role
    if role == SUPERADMIN:
        return list(ALL_KEYS)
    keys = set(ROLE_DEFAULTS.get(role, frozenset()))
    # Deny first, then an explicit grant, then deny again: a revocation written
    # after a grant still means no, which is what a "revoke this person now" click
    # has to mean even if that person was handed the key last week.
    keys -= set(staff.denied_keys or [])
    keys |= {key for key in (staff.granted_keys or []) if key in ALL_KEYS}
    keys -= set(staff.denied_keys or [])
    return sorted(keys)


def can(staff, key):
    return key in permissions_for(staff)


def catalogue():
    return [
        {'key': key, 'label': label, 'group': group, 'roles': list(roles)}
        for key, label, group, roles in CATALOG
    ]


def groups():
    return [{'id': gid, 'label': label} for gid, label in GROUPS]


def row_for(user):
    if not getattr(user, 'is_authenticated', False) or not user.is_staff:
        return None
    return StaffAccount.for_user(user)


def denial(code, detail, **extra):
    return Response({'detail': detail, 'code': code, **extra}, status=403)


def check(request, keys):
    """None when the request may continue, otherwise the 403 to hand back.

    The order is deliberate: an ordinary user, a revoked staff member and a
    half-authenticated session each get their own sentence, because the dashboard
    has to know whether to send the visitor out, say "access ended", or ask for a
    fresh code without losing the screen they were on.
    """
    user = getattr(request, 'user', None)
    if user is None or not user.is_authenticated:
        return denial('sign_in_required', 'Sign in to reach the admin console.')
    if user.seeded:
        return denial('staff_disabled', 'This account cannot access the admin console.')
    # The roster row is asked before the is_staff flag, because switching a seat
    # off clears that flag too: "the console is for staff accounts" would be a
    # misleading answer to someone whose access was ended a minute ago.
    seat = StaffAccount.objects.filter(user=user).first()
    if user.is_suspended or (seat is not None and not seat.is_enabled):
        return denial('staff_disabled', 'Your access to the admin console has ended.')
    if not user.is_staff:
        return denial('staff_only', 'The admin console is for client staff accounts.')
    staff = seat or StaffAccount.for_user(user)
    if not staff.is_enrolled:
        return denial('two_factor_enrolment', 'Set up an authenticator app to continue.', username=user.username)
    payload = read_admin_token(request.COOKIES.get(ADMIN_COOKIE, ''))
    if payload is None or payload.get('sub') != str(user.pk):
        return denial(
            'two_factor_required', 'Confirm your authenticator code to continue.',
            username=user.username,
            admin_expires_at=payload.get('exp') if payload else None,
        )
    missing = [key for key in keys if key not in permissions_for(staff)]
    if missing:
        key = missing[0]
        return denial(
            'permission_required', f'Your role does not include {LABELS.get(key, key)}.',
            permission=key, label=LABELS.get(key, key),
        )
    return None


def staff_only(*keys):
    """Gate a function view: `@api_view([...])` , `@permission_classes([...])`, then this."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(request, *args, **kwargs):
            denied = check(request, keys)
            if denied is not None:
                return denied
            request.staff_account = StaffAccount.objects.get(user=request.user)
            return fn(request, *args, **kwargs)
        return wrapper
    return decorator
