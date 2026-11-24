"""Contract 6.9: reading the log of every action a staff member took, and why.

The log itself belongs to the moderation app and has always been append-only — this
console writes to it through `journal.record()` and reads it here, and nothing in
either direction deletes or edits a row. What this module adds is the shape a
person needs when the Client asks "who turned this off in March": the actions
grouped into the families the contract lists, the accounts that produced them, and
one sentence per row saying who, when, what and the reason that was typed with it.

`family_of()` is a table rather than a dozen `if` statements because the action
names are already written by six other modules, and a log screen that only knows
about the ones it was written the day of would quietly drop next month's verbs into
a bucket nobody filters by.
"""

from django.db.models import Count, Q

from apps.moderation.models import AuditLog

# id, label, the action names or prefixes that belong to it. First match wins.
FAMILIES = (
    ('exports', 'Data exports', ('export_csv',)),
    ('alerts', 'Alerts', ('alert_',)),
    ('spam', 'Spam and safety rules', ('spam_settings', 'policy_term', 'policy_category')),
    ('coins', 'Coins and payments', ('coin', 'coins')),
    ('promotions', 'Paid reach', ('promo', 'promotion')),
    ('settings', 'Platform settings', ('welcome_text', 'platform_settings', 'post_limits', 'coin_settings',
                                       'mail_test')),
    ('staff', 'Staff and access', ('grant_staff', 'revoke_staff', 'update_staff', 'reset_staff', 'admin_login',
                                   'create_staff', 'staff_password', 'staff_recovery')),
    ('notices', 'Public notices', ('attach_notice', 'withdraw_notice', 'public_notice')),
    ('accounts', 'Accounts', ('suspend_user', 'reinstate_user', 'delete_user', 'verify_user', 'unverify_user',
                              'warn_user', 'clear_spam_flags', 'lock_user')),
    ('content', 'Content and reports', ('remove_content', 'release_content', 'restore_content', 'dismiss_report',
                                        'resolve_report', 'remove_report', 'dismiss_reports', 'auto_hide_post')),
)
FAMILY_LABELS = {key: label for key, label, _prefixes in FAMILIES}
# The families the contract names out loud, so the screen can say which of them have
# never been used rather than leaving a seat to guess from an empty filter list.
CONTRACT_FAMILIES = ('content', 'notices', 'accounts', 'coins', 'promotions', 'staff', 'spam', 'alerts', 'exports')


def family_of(action):
    name = str(action or '')
    for key, _label, prefixes in FAMILIES:
        if any(name == prefix or name.startswith(prefix) for prefix in prefixes):
            return key
    return 'other'


def line(item):
    return {
        'id': item.pk,
        'actor': item.actor.username if item.actor else None,
        # An entry with no actor was written by the platform itself — an auto-hide,
        # a seeded import, a cron. Naming it `system` is the difference between a
        # gap in the log and a gap the seat can read.
        'by': item.actor.username if item.actor else 'the platform itself',
        'action': item.action,
        'family': family_of(item.action),
        'target': item.target,
        'detail': item.detail,
        'created_at': item.created_at,
    }


def _action_names():
    return [item['action'] for item in AuditLog.objects.values('action').distinct()]


def family_actions(family):
    return [name for name in _action_names() if family_of(name) == family]


def queryset(actor='', family='', action='', q='', since=None, until=None):
    rows = AuditLog.objects.select_related('actor')
    if actor:
        rows = rows.filter(actor__username__iexact=actor)
    if action:
        rows = rows.filter(action=action)
    if family:
        rows = rows.filter(action__in=family_actions(family))
    if q:
        rows = rows.filter(Q(target__icontains=q) | Q(detail__icontains=q))
    if since:
        rows = rows.filter(created_at__gte=since)
    if until:
        rows = rows.filter(created_at__lte=until)
    return rows


def actions(limit=200):
    """Every verb the log has ever seen, most used first — the filter list."""
    return list(AuditLog.objects.values('action').annotate(n=Count('pk')).order_by('-n')[:limit])


def families():
    """Counts per family, including the families the log has never carried.

    A seat answering "can you prove every coin approval is logged" needs to see the
    zero as plainly as the two hundred, so an untouched family is a row here instead
    of a filter option that silently offers nothing.
    """
    counted = {}
    for item in AuditLog.objects.values('action').annotate(n=Count('pk')):
        key = family_of(item['action'])
        counted[key] = counted.get(key, 0) + item['n']
    out = [{
        'id': key,
        'label': FAMILY_LABELS.get(key, 'Other'),
        'n': counted.pop(key, 0),
        'contract': key in CONTRACT_FAMILIES,
    } for key, _label, _prefixes in FAMILIES]
    for key, n in counted.items():
        out.append({'id': key, 'label': FAMILY_LABELS.get(key, 'Something else'), 'n': n,
                    'contract': key in CONTRACT_FAMILIES})
    return sorted(out, key=lambda item: -item['n'])


def actors(limit=50):
    return [
        {'actor': item['actor__username'], 'n': item['n']}
        for item in AuditLog.objects.exclude(actor__isnull=True).values('actor__username').annotate(
            n=Count('pk'),
        ).order_by('-n')[:limit]
    ]


def summary(rows=None):
    """The one line above the screen: how much there is, who wrote it, how recent."""
    rows = AuditLog.objects if rows is None else rows
    newest = rows.order_by('-created_at').first()
    people = rows.exclude(actor__isnull=True).values('actor').distinct().count()
    return {
        'entries': rows.count(),
        'people': people,
        'system': rows.filter(actor__isnull=True).count(),
        'newest': newest.created_at if newest else None,
    }
