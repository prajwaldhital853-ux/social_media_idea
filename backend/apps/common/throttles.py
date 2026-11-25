from rest_framework.throttling import AnonRateThrottle

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
