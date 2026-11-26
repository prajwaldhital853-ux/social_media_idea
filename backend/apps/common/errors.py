"""One place where API errors become sentences a visitor can act on."""

import logging

from django.http import JsonResponse
from rest_framework.exceptions import Throttled
from rest_framework.views import exception_handler as drf_exception_handler

from .middleware import current_request_id

logger = logging.getLogger(__name__)

# Django has already written the traceback by the time the 500 handler runs; this
# is the sentence the client sees, so it has to be one a person can act on.
SERVER_ERROR = 'The server could not finish that request. Try again in a moment.'


def _request_id_for(request):
    return getattr(request, 'request_id', '') or current_request_id()


def span(seconds):
    """One wait said the way a person would say it, because the desk's windows run
    from a minute to a day and "Wait 3600 seconds" is a number, not an instruction."""
    seconds = max(1, int(seconds or 1))
    if seconds >= 3600:
        hours = round(seconds / 3600)
        return f'{hours} hour{"s" if hours != 1 else ""}'
    if seconds >= 120:
        return f'{round(seconds / 60)} minutes'
    if seconds >= 45:
        return 'a minute'
    return f'{seconds} second{"s" if seconds != 1 else ""}'


def throttle_text(seconds):
    """The one sentence every ceiling gives back, whether it refused a write or was
    asked before one. "From here" covers both buckets a ceiling counts against: the
    account a person signed in as, and the address a visitor with no account has."""
    return f'Too many tries from here. Wait {span(seconds)} and try again.'


def _stamp(response, request):
    """Every error body carries the id, so a screenshot names its own log line."""
    rid = _request_id_for(request)
    if not rid:
        return response
    if isinstance(response.data, dict):
        response.data.setdefault('request_id', rid)
    elif response.data is None:
        response.data = {'request_id': rid}
    else:
        response.data = {'detail': response.data, 'request_id': rid}
    response['X-Request-Id'] = rid
    return response


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    request = context.get('request')
    if response is None:
        return None
    if isinstance(exc, Throttled):
        # DRF's own text is developer copy: "Request was throttled. Expected
        # available in 60 seconds." Say the same thing as an instruction, and hand
        # the client the seconds so a screen can count them down instead of
        # guessing. exc.wait is the full window, which is the honest upper bound.
        seconds = max(1, int(exc.wait or 1))
        response.data = {
            'detail': throttle_text(seconds),
            'retry_in': seconds,
        }
    return _stamp(response, request)


def server_error(request):
    """Uncaught failures as JSON.

    Without this a bug anywhere in the API answers a fetch with an HTML error
    page, which the client can only report as "something unreadable" — and a
    signed-in browser then sits on its spinner with nothing to show. The id is the
    handle: the visitor reads it out, the log line is found.
    """
    return JsonResponse(
        {'detail': SERVER_ERROR, 'request_id': _request_id_for(request)},
        status=500,
        headers={'X-Request-Id': _request_id_for(request)} if _request_id_for(request) else None,
    )
