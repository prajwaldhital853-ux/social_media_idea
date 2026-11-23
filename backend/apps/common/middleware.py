import contextvars
import logging
import re
import time
import uuid

logger = logging.getLogger('exposing.request')

# Render's proxy already sets X-Request-Id, so an id that arrives is kept: a trace
# begun at the edge stays the same trace the app writes about. Anything else (a
# browser, a newline, 4 KB of script) is ignored and a fresh id is minted.
INBOUND_ID = re.compile(r'^[A-Za-z0-9._-]{1,64}$')

# A visitor who is not signed in still asks the server who they are, and the honest
# answer is a 401. Writing that to the log as a warning put one line per anonymous
# page load beside the failures someone actually has to read.
QUIET_PROBES = ('/api/auth/refresh/', '/api/auth/me/', '/api/admin/session/')

_request_id = contextvars.ContextVar('exposing_request_id', default='')


def current_request_id():
    return _request_id.get()


class RequestIdFilter(logging.Filter):
    """Put the id on every record, so any line can be tied to one request."""

    def filter(self, record):
        record.request_id = _request_id.get() or '-'
        return True


class ApiSlashMiddleware:
    """Give /api paths their trailing slash back.

    The Next.js rewrite proxy forwards "/api/auth/login", and APPEND_SLASH can
    only rescue a GET by redirecting — a POST would lose its body. Canonicalising
    first means CSRF exemptions and URL resolution both see the routed form.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info
        if path.startswith('/api/') and not path.endswith('/'):
            path += '/'
            request.path_info = path
            request.path = path
            request.META['PATH_INFO'] = path
        return self.get_response(request)


class RequestIdMiddleware:
    """Stamp every request, and answer with the id the visitor can quote back.

    The bug report is always "it said the server could not finish the request",
    which matches nothing in a log on its own. The id goes out in a header and in
    every JSON error body, so the screenshot and the line are the same event.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.META.get('HTTP_X_REQUEST_ID', '')
        request.request_id = incoming if INBOUND_ID.match(incoming) else uuid.uuid4().hex[:16]
        token = _request_id.set(request.request_id)
        started = time.monotonic()
        try:
            response = self.get_response(request)
            response['X-Request-Id'] = request.request_id
            elapsed = int((time.monotonic() - started) * 1000)
            if response.status_code >= 400:
                expected = response.status_code == 401 and request.path_info in QUIET_PROBES
                logger.log(logging.INFO if expected else logging.WARNING,
                           '%s %s -> %s in %dms', request.method, request.get_full_path(),
                           response.status_code, elapsed)
            elif elapsed >= 3000:
                # A request that worked but took seconds is the prelude to the
                # next "it is stuck on Checking" report. Log it while it is boring.
                logger.warning('%s %s was slow: %dms', request.method, request.get_full_path(), elapsed)
            return response
        finally:
            _request_id.reset(token)
