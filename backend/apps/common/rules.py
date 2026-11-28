"""The questions a member-facing write asks before it saves anything: the console's rules.

The lists and the numbers themselves belong to the admin console, which owns the table
and the desks that edit them. What lives here is the door's side of the asking, so a
sentence carrying blocked wording, a post past the hour's ceiling or a link on the
blocked list is refused on the way in rather than published and then hunted. The
imports are deliberately inside the functions: the member API asks the console a
question, but must not need the console to load in order to answer a post.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response

from apps.common.ratelimit import client_ip, enforce, left


def blocked_wording(request, kind):
    """None when this write may be saved, otherwise the 400 to hand back instead."""
    from apps.adminpanel import policy

    return policy.check(request, kind)


def desk():
    """Every rule the console's spam desk holds, read once per request.

    A desk that cannot be read answers with nothing, which leaves each rule at the
    number the platform shipped with: a settings table that will not load must not be
    able to stop a person posting.
    """
    try:
        from apps.adminpanel import settings_store
        return settings_store.values()
    except Exception:  # noqa: BLE001 - the door answers for itself before the console
        return {}


def whole(values, key, fallback=0):
    """One ceiling as a whole number. Zero means the rule is switched off."""
    try:
        return max(0, int(values.get(key, fallback)))
    except (TypeError, ValueError):
        return fallback


def on(values, key, fallback=False):
    return bool(values.get(key, fallback))


def rate(bucket, key, window, fallback=0, values=None):
    """Count this request against the ceiling the desk holds for `key`.

    The bucket is the thing being measured (an address, an account) and the window is
    how long the count stands, so a seat changes only how much of it is allowed.
    """
    enforce(bucket, whole(values if values is not None else desk(), key, fallback), window)


def room(bucket, key, window, fallback=0, values=None):
    """Whether this bucket still stands inside its ceiling, without using any of it.

    This is the question a button asks before it presses. The write itself is still
    refused by `rate`, so a client that skips the asking changes nothing about what
    the door allows.
    """
    room_left = left(bucket, whole(values if values is not None else desk(), key, fallback), window)
    return room_left is None or room_left > 0


def seat(request):
    """What a per-connection ceiling is counted against.

    A signed-in person is counted as themselves. An address is only used when there
    is no account to count, because an address is a shared thing: a college wifi or a
    carrier hands two hundred people the same one, and a ceiling written as "what one
    reader does in a minute" would refuse them all for what one busy minute looks like
    from outside.
    """
    pk = getattr(getattr(request, 'user', None), 'pk', None)
    return f'account:{pk}' if pk else f'address:{client_ip(request)}'


def post_limits_gate(request):
    """None when this write's size is inside the limits desk's contract, otherwise
    the 400 to hand back instead.

    The composer holds the same numbers, but it is site code: a stale tab, an old
    build or a hand-written request carries whatever it likes. The counts and the
    seconds are judged here, at the door, so nothing oversized is ever saved.
    Each file's size is the upload endpoint's half of the contract and stays there.
    """
    try:
        from apps.adminpanel import limits
        published = limits.public_config()
    except Exception:  # noqa: BLE001 - the door answers for itself before the console
        return None
    data = request.data if isinstance(request.data, dict) else {}
    media = data.get('media') if isinstance(data.get('media'), list) else []
    rows = [row for row in media if isinstance(row, dict)]
    photos = [row for row in rows if row.get('kind') != 'video']
    videos = [row for row in rows if row.get('kind') == 'video']

    text = str(data.get('text') or '')
    chars = published['text']['characters']
    if text and len(text) > chars:
        return Response({'detail': f'A post runs up to {chars} characters. Yours is {len(text)}.'}, status=400)
    most = published['photo']['per_post']
    if len(photos) > most:
        return Response({
            'detail': f'A post carries {most} photo{"s" if most != 1 else ""}. '
                      f'Yours has {len(photos)}, take some out and post again.',
        }, status=400)
    most = published['video']['per_post']
    if len(videos) > most:
        return Response({
            'detail': f'A post carries {most} video{"s" if most != 1 else ""}. '
                      f'Yours has {len(videos)}, take some out and post again.',
        }, status=400)
    seconds = published['video']['seconds']
    longest = max((float(row.get('duration') or 0) for row in videos), default=0)
    if longest > seconds:
        return Response({
            'detail': f'A video here runs up to {seconds} seconds, one of yours runs {round(longest)}.',
        }, status=400)
    return None


def write_gate(request, kind):
    """None when the desk allows this write, otherwise the answer to hand back instead.

    This is what makes the spam desk true rather than decorative: the ceilings on how
    often one account may post, the rules on what a day-old account may not do yet, and
    the switch on blocked links are all read here, at the door, on every write.
    """
    values = desk()
    if kind == 'comment':
        rate(f'comment-hour:{request.user.pk}', 'spam_comment_per_hour', 3600, 20, values)
        return None
    if kind != 'post':
        return None
    refused = _new_account(request, values)
    if refused:
        return refused
    rate(f'post-hour:{request.user.pk}', 'spam_post_per_hour', 3600, 10, values)
    rate(f'post-day:{request.user.pk}', 'spam_post_per_day', 86400, 30, values)
    return _blocked_link(request, values)


def _new_account(request, values):
    """What a brand-new account may not do yet, for as long as a seat says so."""
    user = request.user
    hold = whole(values, 'spam_new_account_hours')
    if hold:
        opens = user.date_joined + timedelta(hours=hold)
        if timezone.now() < opens:
            return Response({
                'detail': f'New accounts wait {hold} hour{"s" if hold != 1 else ""} before their first '
                          f'post. Yours can post from {timezone.localtime(opens):%H:%M}.',
            }, status=403)
    first = whole(values, 'spam_new_account_posts')
    day_ago = timezone.now() - timedelta(days=1)
    if first and user.date_joined >= day_ago and user.posts.filter(created_at__gte=day_ago).count() >= first:
        return Response({
            'detail': f'A first day here carries {first} post{"s" if first != 1 else ""}. '
                      'Your account opens up tomorrow.',
        }, status=403)
    return None


def _blocked_link(request, values):
    """A post pointing at a domain the platform rules desk has blocked."""
    if not on(values, 'spam_link_block', True):
        return None
    data = request.data if isinstance(request.data, dict) else {}
    text = ' '.join(str(data.get('text') or '').split()).lower()
    if not text:
        return None
    from apps.adminpanel import spam

    try:
        blocked = spam.blocked_links()
    except Exception:  # noqa: BLE001 - an unreadable list is not a reason to refuse a post
        return None
    hit = next((term for term in blocked if term and term.lower() in text), None)
    if not hit:
        return None
    from apps.adminpanel import journal

    # The archive records the attempt the way the wording door does, so a seat
    # reading the audit log can see which domain people keep trying to post.
    who = getattr(request.user, 'username', '') or 'an anonymous seat'
    journal.record(None, 'blocked_link', f'post by @{who}', f'{hit}: {_excerpt(data.get("text"))}')
    return Response({
        'detail': f'The platform has blocked links to {hit}. Take it out and post again.',
        'blocked': [hit],
    }, status=400)


def _excerpt(text, length=140):
    return ' '.join(str(text or '').split())[:length]
