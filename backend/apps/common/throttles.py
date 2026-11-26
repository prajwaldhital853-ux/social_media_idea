"""The read ceilings DRF counts every request against.

The per-account and per-visitor ceilings used to live in settings.py as deploy
constants. The Client asked for them at the desk, so both throttles now read the
spam desk on the request itself: throttles are instantiated per request, so a
save at the desk bites the very next request, and a zero typed at the desk
stands the throttle down entirely rather than blocking everybody.

A desk that cannot be read falls back to the shipped rate in settings.py -- the
number the platform was built with stands until a person says otherwise, and an
unreadable table must not be able to stop the site answering.
"""

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from apps.common.ratelimit import client_ip


class AnonIPThrottle(AnonRateThrottle):
    """One anonymous bucket per resolved client address.

    The stock throttle keys on REMOTE_ADDR, which behind the ingress proxy is
    the proxy itself — every stranger on the platform would share a single
    bucket and trip it together. The doors' own limits already key on the
    address client_ip resolves, and this reads the same one.
    """

    def get_ident(self, request):
        return client_ip(request)


def _desk_per_minute(key):
    """The ceiling the desk holds for `key`, as a DRF rate, or None to stand down."""
    from apps.adminpanel import settings_store

    ceiling = int(settings_store.values().get(key, 0))
    return None if ceiling <= 0 else f'{ceiling}/min'


class DeskUserThrottle(UserRateThrottle):
    """One signed-in account's read ceiling, held by the desk."""

    scope = 'user'

    def get_rate(self):
        try:
            return _desk_per_minute('spam_read_per_minute')
        except Exception:  # noqa: BLE001 - the door answers for itself before the console
            return super().get_rate()


class DeskAnonThrottle(AnonIPThrottle):
    """One visitor address's read ceiling, held by the desk."""

    scope = 'anon'

    def get_rate(self):
        try:
            return _desk_per_minute('spam_guest_read_per_minute')
        except Exception:  # noqa: BLE001 - the door answers for itself before the console
            return super().get_rate()
