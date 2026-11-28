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


def coin_terms():
    """What a Coin costs, the smallest purchase and where the rupees land.

    The console's coin pricing desk owns these numbers as rows, so a price the
    Admin saves there is the price the wallet quotes on the next load — the
    constant below is only what a deploy answers with before the desk's table
    exists, and with no desk row written the desk's own defaults stand.
    """
    try:
        from apps.adminpanel import coins as desk
        return desk.pricing()
    except Exception:  # noqa: BLE001 - no settings table yet means the shipped numbers stand
        return {
            'coin_price': COIN_PRICE,
            'min_purchase': 100,
            'bank': {
                'name': os.environ.get('EXPOSING_BANK_NAME', 'Nepal Bank Ltd'),
                'account': os.environ.get('EXPOSING_BANK_ACCOUNT', '0120-4455-8891'),
                'holder': os.environ.get('EXPOSING_BANK_HOLDER', 'Exposing Pvt Ltd'),
                'qr': os.environ.get('EXPOSING_BANK_QR', ''),
            },
        }


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


def market_categories():
    """The marketplace's shelves, as the console named them.

    Platform rules owns this list, so a category added there is sellable on the next
    page load rather than on the next deploy. The shipped eight are not thrown away
    by the first new name, though: a desk where somebody added one shelf is not a
    desk where the other seven were decided against. A shipped shelf only leaves the
    picker once the console has written that exact name down and switched it off,
    which is how the marketplace's own category door already counts a retired label.
    """
    try:
        from apps.adminpanel import policy
        named = policy.category_names()
        written_down = {name.lower() for name in policy.category_names(active_only=False)}
        return named + [label for label in MARKETPLACE_CATEGORIES if label.lower() not in written_down]
    except Exception:  # noqa: BLE001 - no policy table yet means the shipped shelves stand
        return MARKETPLACE_CATEGORIES


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
    """Which doors are open, as the member app reads them.

    These were constants, which made "the admin can turn the marketplace off" a
    deploy. They are the five rows on the console's features desk now, and the same
    answer the endpoints enforce: a greyed button and a refused request come from one
    source, so a stale tab cannot show a door the server has already shut.
    """
    google = bool(getattr(settings, 'GOOGLE_CLIENT_ID', ''))
    try:
        from apps.common import features as switches
        open_doors = switches.state()
    except Exception:  # noqa: BLE001 - no settings table yet means every door is open
        open_doors = {}
    return {
        'video': open_doors.get('video', True),
        'marketplace': open_doors.get('marketplace', True),
        'promotion': open_doors.get('promotion', True),
        'wallet': open_doors.get('wallet', True),
        'messages': open_doors.get('messages', True),
        'googleLogin': google,
        'facebookLogin': os.environ.get('FACEBOOK_APP_ID', '') != '',
        'appleLogin': os.environ.get('APPLE_CLIENT_ID', '') != '',
    }


def post_limits():
    """The size one post is allowed to be, the post limits desk's rows.

    The desk publishes these at `GET /api/limits/config/` for the composer to
    hold a person to; the config travels with them so a composer is held to the
    same numbers whether it read the desk or the boot payload. No desk table yet
    means the shipped numbers stand.
    """
    try:
        from apps.adminpanel import limits as desk
        return desk.public_config()
    except Exception:  # noqa: BLE001 - no settings table yet means the shipped numbers stand
        return {
            'text': {'characters': 2000},
            'photo': {'per_post': 4, 'each_mb': 5, 'each_bytes': 5 * 1024 ** 2},
            'video': {'per_post': 1, 'seconds': 60, 'each_mb': 150, 'each_bytes': 150 * 1024 ** 2},
            'server_upload_mb': 150,
        }


def report_threshold():
    """The pile size the spam desk publishes, not the number the server booted with.

    A desk that moved and a boot value that did not would leave the site hiding
    content at a number nobody chose; this is the same read every other consumer
    makes, with the shipped value standing when no settings table exists.
    """
    try:
        from apps.adminpanel import spam
        return spam.report_threshold()
    except Exception:  # noqa: BLE001 - no settings table yet means the shipped number stands
        return int(getattr(settings, 'EXPOSING_REPORT_THRESHOLD', 3))


def client_config():
    terms = coin_terms()
    return {
        'features': features(),
        'packages': shelf(),
        'categories': market_categories(),
        'countries': COUNTRIES,
        'minAge': MIN_AGE,
        'coinPrice': terms['coin_price'],
        'minPurchase': terms['min_purchase'],
        'limits': post_limits(),
        'threshold': report_threshold(),
        'rateLimits': bool(getattr(settings, 'EXPOSING_RATE_LIMITS', True)),
        'googleClientId': getattr(settings, 'GOOGLE_CLIENT_ID', ''),
        'wording': wording(),
        'bank': terms['bank'],
    }
