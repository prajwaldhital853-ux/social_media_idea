"""Server-owned client configuration: the values the SPA must agree on with the API.

Nothing here is a placeholder: a feature flag flips to True only when the server can
actually serve that flow.
"""

import os

from django.conf import settings

PACKAGE_CATALOG = [
    {'id': 'pk_starter', 'name': 'Starter', 'coins': 100, 'days': 3, 'reach': 'Up to 3,000 people'},
    {'id': 'pk_growth', 'name': 'Growth', 'coins': 300, 'days': 7, 'reach': 'Up to 12,000 people'},
    {'id': 'pk_prime', 'name': 'Prime', 'coins': 800, 'days': 14, 'reach': 'Up to 40,000 people'},
]

MARKETPLACE_CATEGORIES = [
    'Electronics', 'Vehicles', 'Property', 'Fashion', 'Home & Garden', 'Jobs', 'Services', 'Other',
]

COUNTRIES = [
    'Nepal', 'India', 'United States', 'United Kingdom', 'Australia',
    'Japan', 'Germany', 'Other',
]

MIN_AGE = 13
COIN_PRICE = 10

# The identity the DEBUG-only /api/auth/google/ demo branch hands back. It is not a
# seeded account on purpose, so the button also exercises Google-completes-signup.
DEMO_GOOGLE = {'email': 'guest@demo.test', 'name': 'Guest Demo', 'sub': 'demo-google-guest'}


def shelf():
    """The packages the site sells right now: the console's shelf when a seat has
    edited one, the shipped list otherwise.

    The storefront and the delivery engine have to read the same shelf. A payer
    quoted "up to 40,000 people" by a page that was edited, while the feed measures
    the run against the shipped number, is a campaign that quietly never finishes.
    """
    try:
        from apps.adminpanel import promotions as desk
        return desk.packages()
    except Exception:  # noqa: BLE001 - no settings table yet means the shipped shelf stands
        return PACKAGE_CATALOG


def package_by_id(package_id):
    for pack in shelf():
        if pack['id'] == package_id:
            return pack
    return None


def features():
    google = bool(getattr(settings, 'GOOGLE_CLIENT_ID', ''))
    return {
        'video': True,
        'marketplace': True,
        'promotion': True,
        'googleLogin': google,
        # A DEBUG server cannot verify a real Google token, so it offers an
        # explicitly labelled demo identity instead of a broken button.
        'googleDemo': not google and bool(settings.DEBUG),
        'facebookLogin': os.environ.get('FACEBOOK_APP_ID', '') != '',
        'appleLogin': os.environ.get('APPLE_CLIENT_ID', '') != '',
    }


def client_config():
    return {
        'features': features(),
        'packages': shelf(),
        'categories': MARKETPLACE_CATEGORIES,
        'countries': COUNTRIES,
        'minAge': MIN_AGE,
        'coinPrice': COIN_PRICE,
        'threshold': int(getattr(settings, 'EXPOSING_REPORT_THRESHOLD', 3)),
        'rateLimits': bool(getattr(settings, 'EXPOSING_RATE_LIMITS', True)),
        'googleClientId': getattr(settings, 'GOOGLE_CLIENT_ID', ''),
        'demoGoogle': DEMO_GOOGLE if features()['googleDemo'] else None,
        'bank': {
            'name': os.environ.get('EXPOSING_BANK_NAME', 'Nepal Bank Ltd'),
            'account': os.environ.get('EXPOSING_BANK_ACCOUNT', '0120-4455-8891'),
            'holder': os.environ.get('EXPOSING_BANK_HOLDER', 'Exposing Pvt Ltd'),
            'qr': os.environ.get('EXPOSING_BANK_QR', ''),
        },
    }
