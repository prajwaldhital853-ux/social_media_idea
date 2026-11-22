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
    # Contract 6.7: the coin desk. A person pays in rupees and the platform decides
    # what a Coin costs, what the smallest purchase is, and which bank account the
    # money goes to — so all three are rows, not constants, and a price change does
    # not need a deploy. The proof retention is a number too because deleting other
    # people's payment screenshots on a schedule is a promise the contract makes.
    'coin_price': (Decimal('10'), 'dec', 'Price of 1 Coin (NPR)',
                   'What the site quotes for a single Coin when a person buys one.', 'payments'),
    'coin_min_purchase': (100, 'int', 'Smallest coin purchase (Coins)',
                          'The floor a coin purchase is quoted with. Coins, not rupees.', 'payments'),
    'coin_bank_name': ('Nepal Bank Ltd', 'str', 'Bank',
                       'Printed above the account number when a person goes to pay.', 'payments'),
    'coin_bank_account': ('0120-4455-8891', 'str', 'Account number',
                          'The account the rupees are sent to.', 'payments'),
    'coin_bank_holder': ('Exposing Pvt Ltd', 'str', 'Account holder',
                         'The name the payer is told to check the account against.', 'payments'),
    'coin_qr_url': ('', 'str', 'Payment QR code',
                    'The image a person scans instead of typing the account number.', 'payments'),
    'coin_proof_days': (30, 'int', 'Keep a payment proof for (days)',
                        'Payment screenshots are deleted this many days after the request is decided.',
                        'payments'),
    # Contract 6.8: what reaches whom. The site's feed used to hard-code these —
    # three coins for a like, five for a save, two promotions a page — so a
    # promotion that felt too aggressive was a pull request. Now they are rows, and
    # `GET /api/promotions/config/` hands the same numbers to the feed every time it
    # asks what to show.
    'algo_weight_like': (3, 'int', 'Weight of a like', 'Points a past like on this category is worth.', 'promo'),
    'algo_weight_comment': (4, 'int', 'Weight of a comment',
                            'Points a past comment on this category is worth.', 'promo'),
    'algo_weight_save': (5, 'int', 'Weight of a save', 'Points a saved post in this category is worth.', 'promo'),
    'algo_weight_watch': (1, 'int', 'Weight of a reel watched',
                         'Points a reel this person played is worth.', 'promo'),
    'algo_relevance_floor': (2, 'int', 'Lowest score worth showing',
                             'A campaign below this relevance is skipped instead of padded into the feed.',
                             'promo'),
    'promo_daily_cap': (2, 'int', 'Promotions per person per day',
                        'How often one payer may appear in a feed in a day.', 'promo'),
    'promo_repeat_limit': (3, 'int', 'Times one person may see a campaign',
                           'Repeated impressions of the same campaign for the same person.', 'promo'),
    'promo_organic_gap': (4, 'int', 'Ordinary posts between two promotions',
                          'How much of the feed a person gets before the next paid card.', 'promo'),
    'promo_global_pause': (False, 'bool', 'Pause every promotion',
                           'Stops the platform showing paid content at all, without ending any campaign.',
                           'promo'),
    # The three packages the site sells, as they were shipped. Written here as JSON
    # so a price, a run length or a reach promise is an edit and not a deploy; blank
    # means the shipped catalog still stands.
    'promo_packages': ('', 'str', 'Promotion packages (JSON)',
                       'What a campaign costs, how long it runs and how far it reaches.', 'promo'),
    # The wording a suspension email ends with. Contract 6.4 promises the person
    # an appeal route, and 6.6 makes these editable from the dashboard; the
    # address is the platform's own no-reply domain, not a placeholder to fill in.
    'contact_email': ('support@exposing.app', 'str', 'Contact email for enforcement notices',
                      'Printed at the foot of a suspension or warning email.', 'platform'),
    'contact_phone': ('', 'str', 'Contact phone for enforcement notices',
                      'Left out of the email when blank.', 'platform'),
    'contact_form': ('', 'str', 'Support form link',
                     'The link at the bottom of an enforcement email, instead of the site root.', 'platform'),
    # Contract 6.6: the wording a visitor reads the first time the site loads. The
    # Client has seven days to supply it, so the platform ships with its own line
    # rather than an empty box, and a box cleared on purpose falls back to it.
    'welcome_message': ('Welcome to Exposing — show what you are making, and see what everyone '
                        'else is making.', 'str', 'Welcome message',
                        'The sentence on the card a visitor sees first.', 'platform'),
    'tagline': ('Expose the work.', 'str', 'Tagline',
                'The short line under the welcome message and in the page title.', 'platform'),
}

GROUPS = {'safety': 'Safety and audit', 'payments': 'Coins and payments',
          'promo': 'Promotions and reach', 'platform': 'Platform settings'}


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


def lines_group(group):
    """Every knob in one group, with who last turned it and when.

    The desks need the provenance printed beside the box: a price a stranger could
    not tell apart from a price the Client set yesterday is a price nobody trusts.
    """
    values, rows = _cached_rows()
    out = []
    for key, item in values.items():
        if item['group'] != group:
            continue
        row = rows.get(key)
        out.append({
            **item,
            'by': row.updated_by.username if row is not None and row.updated_by else None,
            'at': row.updated_at.isoformat() if row is not None else None,
        })
    return out


def _cached_rows():
    """(every knob at its typed value, the rows that override them) — read once per desk."""
    current = cached()
    return current, {row.key: row for row in AdminSetting.objects.filter(key__in=current)}


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
