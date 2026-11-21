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
