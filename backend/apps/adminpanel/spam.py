"""Contract 6.9, the spam desk: what one person may do, and how content is pulled.

Three kinds of answer live in one screen because a moderator thinks about them
together. *Rates* are how often an account may act; *new-account rules* are what a
day-old account may not do yet; *the pile* is how many people have to say a post is
bad before the platform takes it out of the feed without waiting for a person.

The desk is not a poster. Every number on it is read again by the door that answers
the request -- `apps.common.rules` for the rates and the new-account rules,
`report_threshold()` and `spam_autohide` for the pile -- so moving a knob changes
what a member meets within one request, not at the next deploy. A ceiling of zero
means the rule is switched off rather than blocking everything, which is what the
desk says a zero is.

`report_threshold()` reads a seat's typed answer ahead of the environment value the
server was started with: `EXPOSING_REPORT_THRESHOLD` is a decision somebody made on
a deploy, and a desk that quietly re-derived 3 from its own defaults would overrule
it without saying so.
"""

from django.conf import settings as django_settings

from . import policy, rbac, settings_store
from .journal import record
from .models import PolicyTerm

# Which knobs the desk shows, under which heading, in the order it shows them.
BLOCKS = (
    ('rate', 'How often one person may act', (
        'spam_signup_per_hour', 'spam_login_per_minute', 'spam_share_per_minute', 'spam_view_per_minute',
        'spam_post_per_hour', 'spam_post_per_day', 'spam_comment_per_hour', 'spam_follow_per_hour',
    )),
    ('reads', 'How much one person may read', (
        'spam_read_per_minute', 'spam_guest_read_per_minute', 'spam_guest_feed_rows', 'spam_guest_feed_cache_seconds',
    )),
    ('new', 'What a new account may not do yet', (
        'spam_new_account_hours', 'spam_new_account_posts',
    )),
    ('pile', 'How content leaves the feed without a person', (
        'alert_report_pile', 'spam_autohide', 'spam_link_block',
    )),
)

# Every knob on this desk is enforced: a save moves the site, not just the screen.
ENFORCED = {key for _block, _label, keys in BLOCKS for key in keys}

WRITABLE = {key for _block, _label, keys in BLOCKS for key in keys}


def report_threshold():
    """Distinct open reporters that pull a post out of the feed on their own."""
    started = int(getattr(django_settings, 'EXPOSING_REPORT_THRESHOLD', 3))
    return max(1, int(settings_store.written('alert_report_pile', started)))


def autohide():
    """Whether a pile of reports is allowed to pull a post out by itself at all.

    Read fresh on every report rather than from `public_config`, because the point
    of the desk is that switching this off takes effect on the next complaint, not
    on the next deploy.
    """
    return bool(settings_store.values().get('spam_autohide', True))


def links(active_only=False):
    rows = PolicyTerm.objects.filter(kind=PolicyTerm.Kind.LINK).select_related('created_by')
    if active_only:
        rows = rows.filter(is_active=True)
    return [policy.row_term(row) for row in rows]


def blocked_links():
    return list(PolicyTerm.objects.filter(
        kind=PolicyTerm.Kind.LINK, is_active=True,
    ).values_list('text', flat=True))


def _as_int(value):
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return None


def desk(staff=None):
    """The whole desk: every knob with its provenance, the lists it points at."""
    by_key = {item['key']: item for item in settings_store.lines_group('safety')}
    blocks = [{
        'id': block,
        'label': label,
        'lines': [{**by_key[key], 'enforced': key in ENFORCED} for key in keys],
    } for block, label, keys in BLOCKS]
    return {
        'blocks': blocks,
        'threshold': report_threshold(),
        'autohide': by_key['spam_autohide']['value'],
        'block_links': by_key['spam_link_block']['value'],
        'words': PolicyTerm.objects.filter(kind=PolicyTerm.Kind.WORD, is_active=True).count(),
        'items': PolicyTerm.objects.filter(kind=PolicyTerm.Kind.ITEM, is_active=True).count(),
        'links': links(),
        'enforced': [key for _block, _label, keys in BLOCKS for key in keys],
        'can_write_links': rbac.can(staff, 'blocked_words') if staff is not None else False,
    }


def write(actor, posted):
    """Move the knobs. Only what came back is written, so the audit row names the
    rules that actually changed instead of everything the desk had open."""
    cached = settings_store.cached()
    updates, bad = {}, []
    for key, value in (posted or {}).items():
        if key not in WRITABLE:
            continue
        spec = cached[key]
        if spec['type'] == 'bool':
            # A switch off is written as `0`, not as a blank: a blank means
            # "nobody has touched this", which would put the shipped default back on
            # the screen that just switched it off. Only matters for a knob whose
            # default is on, which is exactly what auto-hide is.
            updates[key] = '1' if str(value).strip().lower() in ('1', 'true', 'yes', 'on') else '0'
            continue
        if str(value).strip() == '':
            updates[key] = ''
            continue
        number = _as_int(value)
        if number is None:
            bad.append(f'{spec["label"]} has to be a whole number.')
            continue
        if key == 'alert_report_pile' and number < 1:
            # Zero here would not be "off", it would be "hide on every report": the
            # number says how big the pile has to be, and the switch beside it is
            # what turns the rule off.
            bad.append('Auto-hide is switched off with the switch beside this number; '
                       'the smallest pile it will pull content for is one report.')
            continue
        if number > 100000:
            bad.append(f'{spec["label"]} is far past any number this desk means.')
            continue
        updates[key] = str(number)
    if bad:
        return 400, {'errors': bad, 'detail': ' '.join(bad)}
    if not updates:
        return 400, {'detail': 'Nothing to save, no rule has been changed.'}
    settings_store.write(actor, updates)
    labels = [cached[key]['label'] for key in updates]
    record(actor, 'spam_settings', 'spam and auto-hide controls',
           'Changed ' + ', '.join(label.lower() for label in labels) + '.')
    return 200, {
        'detail': 'Saved ' + ', '.join(label.lower() for label in labels)
                  + '. The platform publishes the new rules at /api/spam/config/.',
        'changed': list(updates),
        'config': public_config(),
    }


def public_config():
    """What the member site needs to honour the desk, no login, no seat."""
    values = settings_store.values()
    limits = {key: values[key] for key, _label, keys in BLOCKS for key in keys if key != 'alert_report_pile'}
    return {
        'limits': limits,
        'new_account': {
            'hold_hours': values['spam_new_account_hours'],
            'posts_per_day': values['spam_new_account_posts'],
        },
        'auto_hide': {'enabled': bool(values['spam_autohide']), 'reports': report_threshold()},
        'link_block': bool(values['spam_link_block']),
        'blocked_links': blocked_links(),
        'blocked_words': policy.words(),
    }
