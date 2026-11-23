import itertools
from concurrent.futures import ThreadPoolExecutor

from django.db import connections
from rest_framework.test import APIClient

from apps.accounts.auth import issue_access
from apps.accounts.models import User

_counter = itertools.count(1)


def make_user(username=None, **extra):
    username = username or f'tuser{next(_counter)}'
    # A test member is somebody who finished signing up. Sign-in refuses an address
    # that was never confirmed, so an unverified row here would turn every sign-in
    # test into a verification test. Pass email_verified=False to mean it.
    defaults = {'email': f'{username}@test.local', 'password': 'Test-Pass-9271', 'date_of_birth': '1998-04-12', 'country': 'Nepal', 'city': 'Kathmandu', 'email_verified': True}
    defaults.update(extra)
    return User.objects.create_user(username=username, **defaults)


def auth_client(user):
    client = APIClient()
    client.cookies['exposing_access'] = issue_access(user)
    client.cookies['exposing_csrf'] = 'test-csrf-token'
    client.credentials(HTTP_X_CSRF_TOKEN='test-csrf-token')
    return client


def staff_client():
    return auth_client(make_user(is_staff=True))


def run_threads(fn, items, workers=8):
    def wrapper(item):
        try:
            return fn(item)
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(wrapper, items))