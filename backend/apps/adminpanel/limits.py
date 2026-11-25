"""Contract 6.10, the size one post is allowed to be, as a setting instead of a constant.

The contract's defaults are 2,000 characters, four photos of 5 MB each and one video
up to 60 seconds and 150 MB. Until now those numbers lived in the composer and in
the upload endpoint, so making a post roomier for a wedding photographer was a pull
request. Here they are six rows, published at `GET /api/limits/config/` for the site
to read.

The screen also prints what the platform refuses *today*, because the two lists are
not the same and pretending otherwise is how a seat ends up believing a save banner:
the upload endpoint has one hard ceiling (150 MB per file, whatever the file is), and
the composer's own caps are the only place four photos and sixty seconds have ever
been counted. Raising a number here publishes the new rule; the site has to read it,
and the footer says which door the other half of that work lives behind.
"""

from apps.common import uploads

from . import rbac, settings_store
from .journal import record

BLOCKS = (
    ('text', 'What a person may type', ('limit_text_chars',)),
    ('photo', 'How many photos, how big each', ('limit_photo_count', 'limit_photo_mb')),
    ('video', 'How long a video may run, how big', ('limit_video_count', 'limit_video_seconds', 'limit_video_mb')),
)

# A limit of zero photos is not a stricter rule, it is a broken composer. The
# ceilings are the point where a number stops being a limit and becomes a typo that
# costs the platform its whole upload directory.
RANGES = {
    'limit_text_chars': (1, 100000, 'characters in one post'),
    'limit_photo_count': (1, 20, 'photos in one post'),
    'limit_photo_mb': (1, 500, 'the size of one photo'),
    'limit_video_count': (1, 10, 'videos in one post'),
    'limit_video_seconds': (1, 900, 'the length of one video'),
    'limit_video_mb': (1, 2000, 'the size of one video'),
}

WRITABLE = {key for _block, _label, keys in BLOCKS for key in keys}


def keys():
    return tuple(RANGES)


def server_guard():
    """What the API itself refuses today, read from the code that refuses it."""
    return {
        'upload_mb': round(uploads.MAX_BYTES / 1024.0 ** 2),
        'kinds': sorted(uploads.IMAGE_TYPES | uploads.VIDEO_TYPES),
    }


def warned(key, value):
    """The sentence for a number the desk saves but the server cannot yet honour."""
    if key == 'limit_video_mb' and value > server_guard()['upload_mb']:
        return (f'A video over {server_guard()["upload_mb"]} MB is still turned away by the upload endpoint, '
                'which is site code and has its own ceiling. This desk publishes the new number at '
                'GET /api/limits/config/; the endpoint has to read it for the file to actually land.')
    if key == 'limit_photo_mb' and value > server_guard()['upload_mb']:
        return (f'A photo over {server_guard()["upload_mb"]} MB is turned away by the upload endpoint '
                'whichever list it is measured against.')
    return None


def desk(staff=None):
    by_key = {item['key']: item for item in settings_store.lines(keys=WRITABLE)}
    values = settings_store.values()
    published = public_config()
    return {
        'blocks': [{
            'id': block,
            'label': label,
            'lines': [{**by_key[key], 'range': list(RANGES[key][:2])} for key in keys_],
        } for block, label, keys_ in BLOCKS],
        'contract': {key: settings_store.DEFAULTS[key][0] for key in WRITABLE},
        'server': server_guard(),
        'published': published,
        'oversized': [sentence for sentence in (warned(key, values[key]) for key in WRITABLE) if sentence],
        'can_write': rbac.can(staff, 'post_limits') if staff is not None else False,
    }


def _as_int(value):
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def write(actor, posted):
    cached = settings_store.cached()
    updates, bad, notes = {}, [], []
    for key, value in (posted or {}).items():
        if key not in WRITABLE:
            continue
        spec = cached[key]
        number = _as_int(value)
        if number is None:
            bad.append(f'{spec["label"]} has to be a whole number.')
            continue
        low, high, named = RANGES[key]
        if not low <= number <= high:
            bad.append(f'{named} has to be between {low} and {high}.')
            continue
        updates[key] = str(number)
        sentence = warned(key, number)
        if sentence:
            notes.append(sentence)
    if bad:
        return 400, {'errors': bad, 'detail': ' '.join(bad)}
    if not updates:
        return 400, {'detail': 'Nothing to save, no limit has been changed.'}
    settings_store.write(actor, updates)
    labels = [cached[key]['label'] for key in updates]
    record(actor, 'post_limits', 'post limits',
           'Changed ' + ', '.join(label.lower() for label in labels) + '.')
    return 200, {
        'detail': 'Saved ' + ', '.join(label.lower() for label in labels)
                  + '. They are published at GET /api/limits/config/ for the composer and the upload '
                  'endpoint to read, until that code reads them, the site keeps the numbers it ships with.',
        'changed': list(updates),
        'warnings': notes,
        'config': public_config(),
    }


def public_config():
    """What the site needs to hold a person to, no login, no seat, no person's data."""
    values = settings_store.values()
    return {
        'text': {'characters': values['limit_text_chars']},
        'photo': {
            'per_post': values['limit_photo_count'],
            'each_mb': values['limit_photo_mb'],
            'each_bytes': values['limit_photo_mb'] * 1024 ** 2,
        },
        'video': {
            'per_post': values['limit_video_count'],
            'seconds': values['limit_video_seconds'],
            'each_mb': values['limit_video_mb'],
            'each_bytes': values['limit_video_mb'] * 1024 ** 2,
        },
        'server_upload_mb': server_guard()['upload_mb'],
    }
