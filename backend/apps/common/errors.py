"""One place where API errors become sentences a visitor can act on."""

from rest_framework.exceptions import Throttled
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None or not isinstance(exc, Throttled):
        return response
    # DRF's own text is developer copy: "Request was throttled. Expected
    # available in 60 seconds." Say the same thing as an instruction, and hand
    # the client the seconds so a screen can count them down instead of
    # guessing. exc.wait is the full window, which is the honest upper bound.
    seconds = max(1, int(exc.wait or 1))
    response.data = {
        'detail': f'Too many attempts from your connection. Wait {seconds} seconds and try again.',
        'retry_in': seconds,
    }
    return response
