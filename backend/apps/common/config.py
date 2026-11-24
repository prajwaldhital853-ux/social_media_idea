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


def wording():
    """The first-load card the console writes: the welcome sentence, the tagline
    and the contacts under them.

    The wording desk owns these lines and a visitor reads the card before any
    session exists, so it travels with the rest of the public config rather than
    behind a login. No desk on this database means no wording, not an error.
    """
    try:
        from apps.adminpanel import views_welcome
        return views_welcome.card()
    except Exception:  # noqa: BLE001 - the shipped strings stand until the desk is written
        return {}


def features():
    google = bool(getattr(settings, 'GOOGLE_CLIENT_ID', ''))
    return {
        'video': True,
        'marketplace': True,
        'promotion': True,
        'googleLogin': google,
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
        'wording': wording(),
        'bank': {
            'name': os.environ.get('EXPOSING_BANK_NAME', 'Nepal Bank Ltd'),
            'account': os.environ.get('EXPOSING_BANK_ACCOUNT', '0120-4455-8891'),
            'holder': os.environ.get('EXPOSING_BANK_HOLDER', 'Exposing Pvt Ltd'),
            'qr': os.environ.get('EXPOSING_BANK_QR', ''),
        },
    }
