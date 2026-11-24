"""The staff bell: what just happened, kept only for the seats allowed to act on it.

Three rules shape this module. A notice is written to one row per seat rather than
one row shared by the console, because "has this person seen it" is the question the
badge asks and it has to survive two seats reading at different speeds. It is fanned
out by permission at the moment the event happens *and* filtered again on the way
out, so revoking a key hides the pile it pointed at without deleting anyone's trail.
And it is 20 rows deep per seat, no more: a bell that remembers everything is a bell
nobody opens, and the desks behind it hold the real history.

The events are the ones a seat cannot learn about any other way — a report filed
while nobody was watching, a payment proof waiting on a decision. Everything else is
a number on a dashboard and stays there.
"""

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.db.models.signals import post_save
from django.utils import timezone

from apps.moderation.models import Report
from apps.promotions.models import Promotion
from apps.wallet.models import CoinRequest

from . import rbac
from .models import StaffAccount, StaffNotice

# Per seat, unread or not. Older rows are deleted, not hidden: the console is the
# archive, and a bell is a queue with a memory the length of one screen.
KEEP = 20
POLL_SECONDS = 20


def held(seat, user=None):
    """The keys this seat answers to right now.

    A superuser with no roster row yet holds everything: the console lets them
    through the gate on the flag alone, and a bell that hid the pile they are
    allowed to clear would be a worse lie than a row that arrived late.
    """
    if seat is not None:
        return set(rbac.permissions_for(seat))
    return set(rbac.ALL_KEYS) if (user is not None and user.is_superuser) else set()


def _route(href):
    return (href or '').split('?')[0].rstrip('/') or '/'


def _trim(recipient):
    """Drop whatever the newest 20 pushed off the end."""
    dead = list(
        StaffNotice.objects.filter(recipient=recipient)
        .order_by('-created_at', '-pk').values_list('pk', flat=True)[KEEP:]
    )
    if dead:
        StaffNotice.objects.filter(pk__in=dead).delete()


def announce(kind, text, href, permission=''):
    """Tell every enabled seat that may act on this. Returns how many were told.

    Called from inside the request that caused the event, so it stays a handful of
    indexed writes: the number of staff seats is a roster, not a user base.
    """
    seat_rows = StaffAccount.objects.filter(is_enabled=True).select_related('user')
    route = _route(href)
    told = 0
    for seat in seat_rows:
        user = seat.user
        # A demo profile is not a person with a job, and a seat switched off should
        # not accumulate notices nobody will ever read.
        if user.seeded or not user.is_active:
            continue
        if permission and permission not in held(seat):
            continue
        StaffNotice.objects.create(
            recipient=user, kind=kind, text=text[:200], href=href, route=route, permission=permission,
        )
        _trim(user)
        told += 1
    return told


def _demo(user):
    """A profile from the seed, not a person the console should be woken for.

    `seeded` is stamped on a later save than the insert, so the address the seed
    writes is checked too — otherwise reseed a demo and the bell fills with it.
    """
    return user is None or user.seeded or (user.email or '').endswith('@demo.test')


def on_report(instance, created, **kwargs):
    if not created or instance.status != Report.Status.OPEN or _demo(instance.reporter):
        return
    announce(
        'report',
        f'@{instance.reporter.username} reported a {instance.target_type} ({instance.reason})',
        f'/reports?target={instance.target_type}&status=open',
        'reports',
    )


def on_coin_request(instance, created, **kwargs):
    if not created or _demo(instance.user):
        return
    announce(
        'coin_request',
        f'@{instance.user.username} asked for {instance.coins} coins — proof needs a decision',
        '/coins?status=pending',
        'coins_view',
    )


def on_signup(instance, created, **kwargs):
    """A new member, so the directory badge means "someone is waiting to be checked".

    The `seeded` flag is set on a later save than the insert, so a reseed is stopped
    by the address the seed writes as well as by the flag.
    """
    if not created or _demo(instance):
        return
    unverified = not instance.email_verified
    announce(
        'signup',
        f'@{instance.username} joined' + (' without verifying the email yet' if unverified else ''),
        '/people?state=unverified' if unverified else '/people',
        'users',
    )


def on_coin_update(instance, created, update_fields, **kwargs):
    """New proof on a request that was already waiting: the desk has something new to open.

    The row is not created again, so `created` is False and only `update_fields`
    says what changed — the same field the console reads to show "answered".
    """
    if created or 'resubmitted_at' not in (update_fields or []) or _demo(instance.user):
        return
    announce(
        'coin_proof',
        f'@{instance.user.username} sent the proof you asked for ({instance.coins} coins)',
        '/coins?status=pending',
        'coins_review',
    )


def on_promotion(instance, created, update_fields, **kwargs):
    """A campaign that went live: somebody spent coins and the queue has a name on it."""
    if _demo(instance.owner):
        return
    started = (created and instance.status == Promotion.Status.ACTIVE) or (
        not created and 'status' in (update_fields or []) and instance.status == Promotion.Status.ACTIVE
    )
    if not started:
        return
    announce(
        'promotion',
        f'@{instance.owner.username} put a {instance.target_type} behind a campaign',
        '/promotions?status=active',
        'promotions_view',
    )


def connect():
    post_save.connect(on_report, sender=Report, dispatch_uid='bell_report')
    post_save.connect(on_coin_request, sender=CoinRequest, dispatch_uid='bell_coin_request')
    post_save.connect(on_coin_update, sender=CoinRequest, dispatch_uid='bell_coin_proof')
    post_save.connect(on_promotion, sender=Promotion, dispatch_uid='bell_promotion')
    post_save.connect(on_signup, sender=get_user_model(), dispatch_uid='bell_signup')


def line(item, now=None):
    return {
        'id': item.pk,
        'kind': item.kind,
        'text': item.text,
        'href': item.href,
        'route': item.route,
        'permission': item.permission,
        'created_at': item.created_at.isoformat(),
        'age_minutes': int(((now or timezone.now()) - item.created_at).total_seconds() // 60),
    }


def tray(user):
    """Unread notices this seat still holds the key for, and the count per screen.

    The unread-only list is what the drawer shows; `routes` is what turns a nav row
    red, and it is built in the same query pass so opening the tray and painting the
    drawer cannot disagree about how many reports are waiting.
    """
    seat = StaffAccount.objects.filter(user=user).first()
    keys = held(seat, user)
    rows = StaffNotice.objects.filter(recipient=user, read_at__isnull=True).filter(
        Q(permission='') | Q(permission__in=keys)
    ).order_by('-created_at', '-pk')[:KEEP]
    now = timezone.now()
    items = [line(item, now) for item in rows]
    routes = counts_map(
        StaffNotice.objects.filter(recipient=user, read_at__isnull=True)
        .filter(Q(permission='') | Q(permission__in=keys))
        .values('route').annotate(n=Count('pk'))
    )
    return {
        'items': items,
        'total': sum(routes.values()),
        'routes': routes,
        'poll_seconds': POLL_SECONDS,
    }


def counts_map(rows):
    return {row['route']: row['n'] for row in rows if row['route']}


def mark(user, notice_id=None, route=None, all_read=False):
    """Close notices out of this seat's tray.

    A route is marked as a batch because the drawer does the same thing: a seat who
    opened the report queue read what was waiting there, whether or not they ever
    clicked the bell.
    """
    now = timezone.now()
    rows = StaffNotice.objects.filter(recipient=user, read_at__isnull=True)
    if not all_read:
        if notice_id:
            rows = rows.filter(pk=notice_id)
        elif route:
            rows = rows.filter(route=route)
        else:
            return 400, {'detail': 'Say which notice, or which screen, was read.'}
    updated = rows.update(read_at=now)
    return 200, {'detail': f'{updated} notice(s) cleared.', 'cleared': updated, **tray(user)}
