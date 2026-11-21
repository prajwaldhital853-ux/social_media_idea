from django.conf import settings

UNSAFE = {'POST', 'PUT', 'PATCH', 'DELETE'}
CSRF_EXEMPT_PATHS = (
    '/api/auth/login/', '/api/auth/signup/', '/api/auth/google/',
    '/api/auth/otp/', '/api/auth/otp/resend/', '/api/auth/unlock/',
    '/api/auth/unlock/confirm/', '/api/auth/refresh/',
)


class SecurityHeadersMiddleware:
    """Security headers + double-submit CSRF for cookie-authenticated writes."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            request.method in UNSAFE
            and request.COOKIES.get('exposing_access')
            and request.path not in CSRF_EXEMPT_PATHS
            and request.path.startswith('/api/')
        ):
            cookie = request.COOKIES.get('exposing_csrf', '')
            header = request.META.get('HTTP_X_CSRF_TOKEN', '')
            if not cookie or header != cookie:
                from django.http import JsonResponse
                return JsonResponse({'detail': 'CSRF token missing or mismatched.'}, status=403)

        response = self.get_response(request)
        response.setdefault('X-Content-Type-Options', 'nosniff')
        response.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        response.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        response.setdefault('X-Frame-Options', 'DENY')
        response.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
        if request.path.startswith('/api/'):
            response.setdefault('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        if not settings.DEBUG:
            response.setdefault('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
        return response