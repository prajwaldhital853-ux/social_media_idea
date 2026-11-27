"""Wake a browser that has Exposing open nowhere.

Web Push is the browser's own protocol, with no vendor in the middle: the
member's browser hands us an address at its push service, this server encrypts a
card for that browser alone and POSTs it there, and the service worker draws it
whether the tab is in the background, closed, or the page was never reopened.
That is why this does not wait on the Firebase setup the mobile app needs — the
phone and the browser are two different doors, and only one of them is here.

VAPID is the key pair that proves this server may write to those addresses. It
is generated once (`python manage.py pushkeys`) and lives in the environment.
With no key set, every function here does nothing at all and the bell keeps
working on its own, which is what a development database should get.
"""

import json
import logging
import threading
import time

from django.conf import settings
from django.db import connections

from .models import Notification, PushSubscription

logger = logging.getLogger(__name__)

# A bell row is not the same thing as a wake-up. Likes and reactions arrive by
# the dozen on one photo, and a browser that buzzed for each one is switched off
# at the operating system within a week — taking the messages down with it. The
# badge still counts them; they simply do not make noise.
QUIET = {'like', 'reaction'}

# A card that lands after the member already read the row in another tab is a
# surprise, not a reminder. One hour is the honest window for "still news", and
# it is also what lets a phone that was offline catch up when it comes back.
TTL_SECONDS = 3600

# The push service is a third party on the path. It gets a short leash: a request
# that hangs must not hold the thread that is telling everyone else.
SEND_TIMEOUT = 10

# Refusals this many deep mean the address is dead rather than the service being
# busy, and the row stops being worth signing for.
GIVE_UP_AFTER = 12


def configured():
    """Both halves of the pair, or none of it. A key set in only one place is a
    server that subscribes browsers it can never write to."""
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def public_key():
    return settings.VAPID_PUBLIC_KEY if configured() else ''


def queue(row_pk):
    """Hand one bell row to the push thread. Never fails the write that made it.

    Called from `transaction.on_commit`, so the row is visible to the thread
    before it starts: a push fired straight after `create()` can lose the race
    with an outer transaction that has not committed, or is about to roll back.
    """
    if not configured():
        return
    thread = threading.Thread(target=_deliver, args=(row_pk,), daemon=True)
    thread.start()


def queue_card(recipient_id, payload):
    """Write one finished card to every browser that seat has filed."""
    if not configured() or not recipient_id:
        return
    thread = threading.Thread(target=_fan_out, args=(recipient_id, payload), daemon=True)
    thread.start()


def _fan_out(recipient_id, payload):
    try:
        # A thread must not inherit the request's connection: the request
        # returns and puts it back in the pool while this is still holding it.
        connections.close_all()
        for sub in list(PushSubscription.objects.filter(user_id=recipient_id)):
            _send(sub, payload)
    except Exception:
        logger.exception('Could not deliver a push notification')


def _name(user):
    if user is None:
        return 'Exposing'
    profile = getattr(user, 'profile', None)
    return (getattr(profile, 'display_name', '') or user.username) if profile else user.username


def _payload(row):
    """The card the operating system draws. A link and a sentence — never a secret."""
    return {
        'title': _name(row.actor)[:60],
        'body': (row.text or 'Something new is waiting for you on Exposing.')[:180],
        # One card per conversation or per post, so the tenth message replaces
        # the ninth instead of stacking a pile on the same thread.
        'tag': f'{row.kind}:{row.target_type or "bell"}:{row.target_id or row.pk}'[:120],
        # A tagged card that replaces another is silent unless it asks to be
        # heard again, so without this the second message in a thread arrives as
        # a ghost — the card swaps, no buzz.
        'renotify': True,
        # The bell row's own page: it marks itself read, shows the warning or
        # comment it came from, and needs no route table kept in step with this.
        'url': f'/notifications/{row.pk}',
    }


def notice_card(notice):
    """The staff bell's own card. It lands on the console's desk, not on a page
    only a member has, because the href was written with the notice."""
    return {
        'title': 'Exposing staff',
        'body': (notice.text or 'Something needs a decision.')[:180],
        # One card per notice, so a second report does not silently swallow the
        # first one's card the way a shared tag would.
        'tag': f'staff:{notice.kind}:{notice.pk}'[:120],
        'renotify': True,
        'url': notice.href or '/overview',
    }


def _deliver(row_pk):
    try:
        # A thread must not inherit the request's connection: the request
        # returns and puts it back in the pool while this is still holding it.
        connections.close_all()
        row = Notification.objects.select_related('actor').filter(pk=row_pk).first()
        if row is None or row.kind in QUIET:
            return
    except Exception:
        logger.exception('Could not deliver a push notification')
        return
    _fan_out(row.recipient_id, _payload(row))


def _send(sub, payload):
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={
                'endpoint': sub.endpoint,
                'keys': {'p256dh': sub.p256dh, 'auth': sub.auth},
            },
            data=json.dumps(payload),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={'sub': f'mailto:{settings.VAPID_CLAIMS_EMAIL}'},
            ttl=TTL_SECONDS,
            timeout=SEND_TIMEOUT,
            headers={'Urgency': 'high'},
        )
        if sub.fails:
            PushSubscription.objects.filter(pk=sub.pk).update(fails=0)
    except WebPushException as err:
        code = getattr(err.response, 'status_code', 0)
        if code in (400, 404, 410):
            # The push service is saying this address is gone or was never well
            # formed: the member cleared site data, unsubscribed, or the keys
            # stopped matching the browser. Keeping the row would mean signing
            # letters forever for a device that will never read them.
            PushSubscription.objects.filter(pk=sub.pk).delete()
        else:
            # 402, 429 and every 5xx are our problem or the service's, not the
            # browser's. A transient refusal must not delete a live subscription.
            _count_failure(sub)
    except Exception:
        logger.exception('The push service could not be reached')


def _count_failure(sub):
    PushSubscription.objects.filter(pk=sub.pk).update(fails=sub.fails + 1)
    if sub.fails + 1 >= GIVE_UP_AFTER:
        PushSubscription.objects.filter(pk=sub.pk).delete()
