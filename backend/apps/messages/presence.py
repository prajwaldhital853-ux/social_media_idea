"""Who is looking at a thread, and who is typing in it.

Two live screens need the same answer in under a second and cannot ask each
other, because they are held by different requests: the send path wants to know
whether a bell is pointless when the reader is already watching the thread, and
the thread stream wants the typing flag its own request never saw.

The cache answers both. Every entry expires by itself, which is the whole point —
a closed tab, a phone locked mid-sentence and a browser that vanished all leave
behind a flag that stops claiming somebody is here a few seconds later.
"""

import time

from django.core.cache import cache

# A watcher re-proves itself once a second, so six seconds of silence means the
# stream is gone and the next message is worth a notification after all.
WATCH_SECONDS = 6
# Shorter than the indicator's own lifetime on screen: a typing flag nobody
# renews is a stalled tab, not somebody still thinking.
TYPING_SECONDS = 4


def _pair(a, b):
    lo, hi = sorted((int(a), int(b)))
    return f'{lo}:{hi}'


def _watch_key(user_pk, peer_pk):
    return f'exposing:watching:{_pair(user_pk, peer_pk)}:{user_pk}'


def _typing_key(user_pk, peer_pk):
    return f'exposing:typing:{_pair(user_pk, peer_pk)}:{user_pk}'


def mark_watching(user_pk, peer_pk):
    cache.set(_watch_key(user_pk, peer_pk), 1, WATCH_SECONDS)


def stop_watching(user_pk, peer_pk):
    cache.delete(_watch_key(user_pk, peer_pk))


def is_watching(user_pk, peer_pk):
    """True while `user_pk` holds this thread open on some screen."""
    return cache.get(_watch_key(user_pk, peer_pk)) is not None


def note_typing(user_pk, peer_pk):
    """Stamp the beat. The stream reports the stamp, so each one shows once."""
    beat = time.time()
    cache.set(_typing_key(user_pk, peer_pk), beat, TYPING_SECONDS)
    return beat


def typing_beat(user_pk, peer_pk):
    return cache.get(_typing_key(user_pk, peer_pk))
