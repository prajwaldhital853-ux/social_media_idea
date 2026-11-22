"""Typed access to the console's knobs, with the defaults the contract names.

Every later section reads its numbers through here instead of hard-coding them,
which is what makes "adjustable thresholds" a click rather than a deploy. A row
that cannot be parsed falls back to its default: a settings screen must never be
able to take the dashboard down with a stray "abc" in a number box.
"""

from decimal import Decimal, InvalidOperation

from .models import AdminSetting

# key: (default, type, label, help, group)
DEFAULTS = {
    'alert_report_pile': (3, 'int', 'Reports before content is pulled',
                          'Distinct open reports on one post that hides it pending review.', 'safety'),
    'alert_report_age_hours': (24, 'int', 'A report may sit unanswered for (hours)',
                               'Raises an alert when an open report is older than this.', 'safety'),
    'alert_coin_queue_hours': (24, 'int', 'A coin request may wait for (hours)',
                               'Raises an alert when a payment proof is older than this.', 'payments'),
    'alert_storage_gb': (Decimal('5'), 'dec', 'Storage alert at (GB)',
                        'Raises an alert once uploaded media passes this much space.', 'safety'),
    'alert_staff_lockouts': (2, 'int', 'Staff lockouts that count as a pattern',
                             'Raises an alert when this many seats lock inside an hour.', 'safety'),
    'alert_autohide_day': (10, 'int', 'Auto-hides a day that looks like a wave',
                           'Raises an alert when moderation hides this much content in 24 hours.', 'safety'),
    # The wording a suspension email ends with. Contract 6.4 promises the person
    # an appeal route, and 6.6 makes these editable from the dashboard; the
    # address is the platform's own no-reply domain, not a placeholder to fill in.
    'contact_email': ('support@exposing.app', 'str', 'Contact email for enforcement notices',
                      'Printed at the foot of a suspension or warning email.', 'platform'),
    'contact_phone': ('', 'str', 'Contact phone for enforcement notices',
                      'Left out of the email when blank.', 'platform'),
    'contact_form': ('', 'str', 'Support form link',
                     'The link at the bottom of an enforcement email, instead of the site root.', 'platform'),
}

GROUPS = {'safety': 'Safety and audit', 'payments': 'Coins and payments',
          'platform': 'Platform settings'}


def _coerce(raw, kind, fallback):
    if raw is None or raw == '':
        return fallback
    try:
        if kind == 'int':
            return max(0, int(float(raw)))
        if kind == 'dec':
            value = Decimal(str(raw))
            return value if value >= 0 else fallback
        if kind == 'bool':
            return str(raw).strip().lower() in ('1', 'true', 'yes', 'on')
    except (TypeError, ValueError, InvalidOperation):
        return fallback
    return str(raw)


def defaults():
    return {key: spec[0] for key, spec in DEFAULTS.items()}


def cached(rows=None):
    """Every known key at its current value, overridden rows winning."""
    stored = rows if rows is not None else {row.key: row.value for row in AdminSetting.objects.all()}
    out = {}
    for key, (fallback, kind, label, help_text, group) in DEFAULTS.items():
        out[key] = {
            'key': key,
            'value': _coerce(stored.get(key), kind, fallback),
            'default': fallback,
            'set': key in stored and str(stored[key]).strip() != '',
            'type': kind,
            'label': label,
            'help': help_text,
            'group': group,
        }
    return out


def values():
    return {key: item['value'] for key, item in cached().items()}


def get(key):
    item = cached().get(key)
    return item['value'] if item else None


def write(actor, updates):
    """Apply {key: value} and hand back the full, typed picture."""
    for key, value in updates.items():
        if key not in DEFAULTS:
            raise ValueError(f'Unknown setting: {key}')
        row, _ = AdminSetting.objects.get_or_create(key=key)
        row.value = '' if value is None else str(value)
        row.updated_by = actor if getattr(actor, 'pk', None) else None
        row.save(update_fields=['value', 'updated_by'])
    return cached()
