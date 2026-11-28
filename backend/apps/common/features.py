"""The doors a seat can close, read at the endpoint instead of only in the browser.

The member app greys a control the moment it learns a feature is closed, but a greyed
button is site code: a hand-written request, a tab that never re-read the config, or a
build from last week all still know the URL. So every door that *changes* something
asks this module first and answers with the sentence the button was going to print.

Reads stay open on purpose. A closed marketplace that hides its own offers looks like a
broken site rather than a closed one, and a person whose wallet is shut still has a
balance they were charged for. What closes is the ability to make something happen.
"""

import json
from functools import wraps

from django.core.cache import cache
from rest_framework.response import Response

# feature key: (the settings row that holds it, the sentence this door answers with)
FLAGS = {
    'marketplace': ('feature_marketplace', 'The marketplace is turned off by the admin for now.'),
    'video': ('feature_video', 'Video and reels are turned off by the admin for now.'),
    'wallet': ('feature_wallet', 'Coins and the wallet are turned off by the admin for now.'),
    'messages': ('feature_messages', 'Messages are turned off by the admin for now.'),
    'promotion': ('feature_promotion', 'Promotions are turned off by the admin for now.'),
}

# How long one answer is reused. Long enough that a busy feed is not a settings query
# per request, short enough that a click at the desk is the next page a member loads.
TTL = 10
CACHE_KEY = 'site-feature-flags'


def state():
    """Every flag as ``{key: bool}``, with the shipped answer standing when there is
    no settings table to read: a desk that cannot be reached closes nothing."""
    try:
        raw = cache.get(CACHE_KEY)
        if raw:
            return json.loads(raw)
    except Exception:  # noqa: BLE001 - a cache that cannot be read is a cache miss
        pass
    try:
        from apps.adminpanel import settings_store
        values = settings_store.values()
    except Exception:  # noqa: BLE001 - no desk yet means every door is open
        values = {}
    flags = {key: bool(values.get(row, True)) for key, (row, _said) in FLAGS.items()}
    try:
        cache.set(CACHE_KEY, json.dumps(flags), TTL)
    except Exception:  # noqa: BLE001 - the answer is still correct without the reuse
        pass
    return flags


def off(name):
    return not state().get(name, True)


def sentence(name):
    return FLAGS[name][1]


def notice(name):
    """None when this door is open, otherwise the 409 to hand back instead of writing.

    The feature is named in the body as well as the sentence, so a client that already
    knows what it is looking at can grey that one control instead of guessing from text.
    """
    if not off(name):
        return None
    return Response({'detail': sentence(name), 'feature': name}, status=409)


def closed(name):
    """Turn a whole write door into one that answers while the feature is shut.

    Used where a view does only that one thing, so the rule sits above the function
    instead of inside it and cannot be missed by whoever adds the next branch.
    """
    def wrap(view):
        @wraps(view)
        def inner(request, *args, **kwargs):
            refused = notice(name)
            if refused:
                return refused
            return view(request, *args, **kwargs)
        return inner
    return wrap


def clear():
    """Forget the reused answer, so a save at the desk stands on the next request."""
    try:
        cache.delete(CACHE_KEY)
    except Exception:  # noqa: BLE001 - the window is short enough to expire on its own
        pass
