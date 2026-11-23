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
    # Contract 6.9: the rest of the alert list. Every one of these is a sentence the
    # platform can prove from a table it already writes, or from a reporter that
    # stamps itself in `AdminPulse` — which is why "no uptime probe for N minutes"
    # and "nothing has ever reported a backup" are two different alerts, not one.
    'alert_web_stale_minutes': (10, 'int', 'No answer from the public site for (minutes)',
                                'Raises an alert when the uptime probe stops reporting. Site down.', 'safety'),
    'alert_backup_stale_hours': (26, 'int', 'No backup for (hours)',
                                 'Raises an alert when the backup job stops reporting. 26 lets a daily run be a day late.',
                                 'safety'),
    'alert_error_rate': (20, 'int', 'App errors in an hour',
                         'Raises an alert when the error reporter counts more than this in an hour.', 'safety'),
    'alert_backlog_jobs': (50, 'int', 'Jobs waiting before it is a backlog',
                           'Raises an alert when the processing queue reports more than this many jobs waiting.',
                           'safety'),
    'alert_backlog_minutes': (30, 'int', 'No word from the processing queue for (minutes)',
                              'Raises an alert when whatever transcodes uploads stops reporting in.', 'safety'),
    'alert_signup_wave': (25, 'int', 'New accounts in an hour that looks like a wave',
                          'Raises an alert when this many accounts join inside an hour. Spam registrations arrive like that.',
                          'safety'),
    'alert_report_spike': (15, 'int', 'Reports in an hour that looks like a spike',
                           'Raises an alert when this many reports arrive inside an hour, whoever they point at.',
                           'safety'),
    'alert_login_locks': (5, 'int', 'Accounts locked at one time',
                          'Raises an alert when this many member accounts are locked out of sign-in at once.', 'safety'),
    'alert_disk_percent': (85, 'int', 'Disk used before it is a problem (%)',
                           'Raises an alert once the volume the uploads and the database sit on passes this.', 'safety'),
    'alert_db_size_mb': (2048, 'int', 'Database size that deserves attention (MB)',
                         'Raises an alert when the database grows past this much.', 'safety'),
    'alert_coin_spike': (10, 'int', 'Coin requests in an hour that is unusual',
                        'Raises an alert when this many people ask for coins inside an hour.', 'safety'),
    'alert_coin_coins_hour': (3000, 'int', 'Coins asked for in an hour that is unusual',
                              'Raises an alert when the requests in one hour add up to more coins than this.', 'safety'),
    # Contract 6.9: the spam desk. The first four are the numbers the site enforces
    # today, written down so a seat can see them in one place; the rest are the
    # limits and restrictions the contract asks for, published at
    # `GET /api/spam/config/` for the site to enforce. `alert_report_pile`, above,
    # is the auto-hide number — one row, because two knobs that both mean "how many
    # reports pull a post" would drift apart within a month.
    'spam_signup_per_hour': (3, 'int', 'Sign-ups one address may start in an hour',
                             'What the site already holds: a fourth sign-up from one address is refused.', 'safety'),
    'spam_login_per_minute': (10, 'int', 'Sign-in tries one account may get in a minute',
                              'What the site already holds: after this the attempt is refused, right password or not.',
                              'safety'),
    'spam_share_per_minute': (30, 'int', 'Shares one address may send in a minute',
                              'What the site already holds on the share button.', 'safety'),
    'spam_view_per_minute': (120, 'int', 'Feed reads one address may make in a minute',
                            'What the site already holds on the feed itself.', 'safety'),
    'spam_post_per_hour': (10, 'int', 'Posts one account may make in an hour',
                           'The ceiling a normal person never reaches and a script does.', 'safety'),
    'spam_post_per_day': (30, 'int', 'Posts one account may make in a day',
                          'The daily ceiling, counted with the hourly one.', 'safety'),
    'spam_comment_per_hour': (20, 'int', 'Comments one account may make in an hour',
                              'Copy-pasted under every post is what this ceiling is for.', 'safety'),
    'spam_follow_per_hour': (30, 'int', 'Accounts one account may follow in an hour',
                             'Follow-and-drop farms run into this one first.', 'safety'),
    'spam_new_account_hours': (1, 'int', 'A new account may not post for (hours)',
                               'Zero lets a fresh account post straight away.', 'safety'),
    'spam_new_account_posts': (5, 'int', 'Posts a first-day account may make',
                               'The ceiling for an account in its first day, whatever its age limit says.', 'safety'),
    'spam_new_account_verify': (False, 'bool', 'Hold a new account until its email is verified',
                                'An unverified address cannot post at all while this is on.', 'safety'),
    'spam_autohide': (True, 'bool', 'Pull content out of the feed on report counts alone',
                      'Switch this off and every report waits for a person to read it.', 'safety'),
    'spam_link_block': (True, 'bool', 'Refuse a post that carries a blocked link',
                        'Matches the link list below against what a post points at.', 'safety'),
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
    'algo_weight_follow': (6, 'int', 'Weight of following the payer',
                           'Points a person who already follows this payer is worth.', 'promo'),
    'promo_weight_target': (1, 'int', 'Weight of one audience match',
                            'Points for each of age band, country and city the payer asked for '
                            'that this person actually fits.', 'promo'),
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
    # Contract 6.10: the size of one post. These were the member app's own hard
    # numbers — 2,000 characters, four photos, one 60-second video — which made the
    # sentence "the Admin can change the post limits" a deploy. They are rows now,
    # published at `GET /api/limits/config/` for the composer and the upload guard
    # to read; `limits.py` also says out loud when a typed number passes what the
    # server itself can accept today, so a seat is never surprised by a 413.
    'limit_text_chars': (2000, 'int', 'Characters in one post',
                         'How much a person is allowed to write above their photos.', 'platform'),
    'limit_photo_count': (4, 'int', 'Photos in one post',
                          'The attach button stops counting here.', 'platform'),
    'limit_photo_mb': (5, 'int', 'Size of one photo (MB)',
                       'A photo heavier than this is refused before it is stored.', 'platform'),
    'limit_video_count': (1, 'int', 'Videos in one post',
                          'More than one turns a post into a reel shelf, not a post.', 'platform'),
    'limit_video_seconds': (60, 'int', 'Length of one video (seconds)',
                            'The composer measures the clip and refuses past this.', 'platform'),
    'limit_video_mb': (150, 'int', 'Size of one video (MB)',
                       'The heaviest file the upload endpoint is expected to take.', 'platform'),
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


def lines(keys=None, group=None):
    """The knobs a desk shows, with who last turned each one and when.

    Pass the keys a screen is built from, or a group name for everything in it.
    A desk needs the provenance printed beside the box: a price a stranger could
    not tell apart from a price the Client set yesterday is a price nobody trusts.
    """
    current, rows = _cached_rows()
    out = []
    for key, item in current.items():
        if keys is not None and key not in keys:
            continue
        if group is not None and item['group'] != group:
            continue
        row = rows.get(key)
        out.append({
            **item,
            'by': row.updated_by.username if row is not None and row.updated_by else None,
            'at': row.updated_at.isoformat() if row is not None else None,
        })
    return out


def lines_group(group):
    """Every knob in one group — the shape the safety and coin desks were written against."""
    return lines(group=group)


def _cached_rows():
    """(every knob at its typed value, the rows that override them) — read once per desk."""
    current = cached()
    return current, {row.key: row for row in AdminSetting.objects.filter(key__in=current)}


def values():
    return {key: item['value'] for key, item in cached().items()}


def get(key):
    item = cached().get(key)
    return item['value'] if item else None


def written(key, fallback=None):
    """What a seat actually typed, or the value the platform started with.

    `cached()` answers with the shipped default for a key nobody has opened, which
    is right for a desk and wrong for a knob the server was also booted with: the
    fallback here is that environment value, so a deploy's decision stands until a
    person at the desk says otherwise.
    """
    spec = DEFAULTS.get(key)
    if spec is None:
        return None
    row = AdminSetting.objects.filter(key=key).first()
    if row is None or str(row.value).strip() == '':
        return spec[0] if fallback is None else fallback
    return _coerce(row.value, spec[1], spec[0])


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
