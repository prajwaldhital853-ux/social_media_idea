"""The doors around an account: its address and its browser.

A password lock used to be a note on one row, which meant three wrong passwords
closed one door and left the rest standing open — sign up again, or take the
Google door on the very address that had just locked, which cleared its own
counter on the way in. A trip now writes a ban for the address and the browser,
and every way in reads those rows before it looks at a credential. A connection
ban is reserved for a deliberate staff decision: a household or mobile carrier
shares one public address, so a password mistake must never close it for everyone.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response

from apps.common.ratelimit import client_ip

from .models import AuthBan

# The first trip costs exactly the cooloff the password form already promises, so
# nobody who mistyped twice is punished twice. Every further round of guessing
# inside a day is a person who was already told to wait, and costs more than the
# round before it.
LADDER_MINUTES = (5, 60, 360)
STRIKE_WINDOW = timedelta(hours=24)
# client_ip answers 'unknown' when nothing identified the caller and an absent
# header means no device at all. Either one stored as a ban value would shut every
# anonymous visitor out through a missing header.
BLIND = ('', 'unknown')

COPY = {
    'email': 'Too many wrong passwords on this account. Everything that opens it is '
             'closed for {time}, sign in with the right password once it lifts.',
    'device': 'This browser was used to guess passwords too many times. Signing up and '
              'signing in are closed here for {time}.',
    'ip': 'This connection is blocked by staff until {time}.',
}


def _body(request):
    data = getattr(request, 'data', None)
    return data if isinstance(data, dict) else {}


def device_of(request):
    return str(_body(request).get('device_id') or request.META.get('HTTP_X_DEVICE_ID') or '')[:80]


def _spoken(seconds):
    if seconds >= 3600:
        hours = round(seconds / 3600)
        return f'{hours} hour' + ('s' if hours != 1 else '')
    return f'{max(1, round(seconds / 60))} minute' + ('s' if seconds > 90 else '')


def blocking(request, email=''):
    """The closed door this request is standing in front of, or None.

    The address is asked first: it is the answer the person earned, and a
    deliberate connection ban that happens to cover them too would say the wrong thing.
    """
    now = timezone.now()
    wanted = [('email', email), ('ip', client_ip(request)), ('device', device_of(request))]
    for scope, value in wanted:
        if not value or value in BLIND:
            continue
        row = AuthBan.objects.filter(scope=scope, value=value, until__gt=now).order_by('-until').first()
        if row is not None:
            return row
    return None


def refuse(row):
    """423, in the shape the password lock already answers with, so one countdown
    panel serves an account lock, a device ban or a deliberate connection ban."""
    seconds = max(1, int((row.until - timezone.now()).total_seconds()))
    return Response({
        'detail': COPY[row.scope].format(time=_spoken(seconds)),
        'locked': True, 'banned': True, 'scope': row.scope,
        'until': row.until, 'retry_in': seconds,
    }, status=423)


def raise_bans(email, until, reason, *, ip='', devices=()):
    """Close the address, an explicitly supplied connection and each browser.

    Password trips and account suspensions do not pass an IP. One row per scope,
    and never a shorter answer than the one already written: an admin ban that runs
    to the end of time must not be trimmed by a cooloff. Returns the scopes it closed.
    """
    identity = (email or '').strip().lower()
    now = timezone.now()
    wanted = [('email', identity), ('ip', ip)] + [('device', d) for d in devices]
    closed = []
    for scope, value in wanted:
        if not value or value in BLIND:
            continue
        row = AuthBan.objects.filter(scope=scope, value=value, until__gt=now).order_by('-until').first()
        if row is None:
            # An expired row is left alone as the strike the next round counts; only
            # a door that is still shut gets pushed further rather than written twice.
            AuthBan.objects.create(
                scope=scope, value=value, identity=identity, reason=reason, until=until,
            )
            closed.append(scope)
            continue
        row.until = max(row.until, until)
        # A staff decision is the louder one; a password cooloff must not rename it.
        if row.reason != 'admin':
            row.reason = reason
            row.identity = identity or row.identity
        row.save(update_fields=['until', 'reason', 'identity'])
    return closed


def trip(request, user):
    """Three wrong passwords: lock this account and the browser that guessed."""
    now = timezone.now()
    strikes = AuthBan.objects.filter(
        scope='email', value=user.email, created_at__gte=now - STRIKE_WINDOW,
    ).count()
    minutes = LADDER_MINUTES[min(strikes, len(LADDER_MINUTES) - 1)]
    until = now + timedelta(minutes=minutes)
    user.locked_until = until
    user.save(update_fields=['locked_until'])
    raise_bans(user.email, until, 'lock', devices=[device_of(request)])
    return minutes, until


def lift(email, *, reasons=None):
    """Open again everything raised on behalf of this address.

    Bans are keyed by the identity that caused them, so the emailed unlock code
    lifts that account and its browser bans. Deliberate connection bans remain a
    separate staff decision and are not inferred from a password mistake.
    """
    identity = (email or '').strip().lower()
    if not identity:
        return 0
    rows = AuthBan.objects.filter(identity=identity)
    if reasons:
        rows = rows.filter(reason__in=reasons)
    return rows.delete()[0]
