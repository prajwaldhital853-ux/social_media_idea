"""Reset the two seats the console walkthrough plays with, and the wording it rewrote.

`admin/qa/console.mjs` verifies a *first* sign-in, so both accounts have to start
out with no authenticator. Only those two rows are touched: the demo Client
account loses its admin seat record, and the throwaway Moderator account
(`moddemo`, created for this suite) loses its seat and its staff flag. The three
platform settings section 9 types over, the four numbers section 10 writes on the coin
desk, the dials section 11 writes on the reach desk and the rules the last run turned
on the spam, alerts and post-limit desks all go back to the file defaults, so the demo
site is never left quoting a QA sentence, a pushed-up weight or a pile threshold of 2,
and the two families of log row the safety walkthrough reads as a gap on its first
pass go back to being a gap rather than a record of the run before it.
Nothing
else in the database is read or written, and the main site's own accounts, sessions and
profiles are left exactly as they are.

    backend/.venv/Scripts/python.exe admin/qa/reset.py
"""

import os
import sys

import django

# Run from anywhere: the settings package lives in backend/, not next to this file.
BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
sys.path.insert(0, BACKEND)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')
django.setup()

from apps.accounts.models import User  # noqa: E402
from apps.adminpanel import alerts, limits, spam  # noqa: E402
from apps.adminpanel.models import AdminAlert, AdminPulse, AdminSetting, StaffAccount  # noqa: E402
from apps.moderation.models import AuditLog  # noqa: E402

OWNER = 'sita'
SEAT = 'moddemo'
# The lines section 9 of the walkthrough writes from the welcome desk.
WORDING = ('welcome_message', 'tagline', 'contact_phone')
# And the numbers section 10 turns on the coin desk: a price it tests, a floor it
# tests, a retention window it drives to zero to watch the sweep delete, and the
# payment QR it uploads. Deleting the rows hands every one back to the contract's
# own default — the desk has no "reset" button because a reset is a write.
COIN_DESK = ('coin_price', 'coin_min_purchase', 'coin_proof_days', 'coin_qr_url')
# And the reach dials section 11 turns: the ranking weights, the gate, the caps, the
# one switch that stops paid reach, and the package shelf. Each is tested by moving it
# one notch off the number the code shipped with, so a run that leaves them cocked
# would make the next run's "one notch" a different number.
REACH_DESK = ('promo_packages', 'promo_global_pause', 'algo_weight_like', 'algo_weight_comment',
              'algo_weight_save', 'algo_weight_watch', 'algo_relevance_floor', 'promo_daily_cap',
              'promo_repeat_limit', 'promo_organic_gap')
# The dials the 6.9 and 6.10 desks turn. Each module already names its own keys, so
# a knob added to a desk later is rolled back without anybody remembering to copy it
# here — which matters most for the pile threshold: leave it at 2 and the next run
# reads a flagged list no other run ever saw.
WATCH_DESK = tuple(sorted(set(spam.WRITABLE) | set(alerts.THRESHOLDS) | set(limits.WRITABLE)))
# The log families the safety walkthrough must find unwritten when it first opens
# `/audit`. "Nobody has ever exported a file" and "nobody exported one this month"
# look identical in a gap list, and telling them apart is the screen's whole job — so
# these two families go back to nothing between runs, and the list the run reads is a
# fact about the platform rather than about the run before it. Every other verb stays
# where it is: nothing in the console deletes a log row, and this script only removes
# what a console run wrote.
LOG_GAPS = ('alert_', 'export_csv')


def main():
    owner = User.objects.filter(username=OWNER).first()
    if owner is None:
        raise SystemExit(f'{OWNER} is missing — the seeded demo accounts are not in this database.')
    StaffAccount.objects.filter(user=owner).delete()

    seat = User.objects.filter(username=SEAT).first()
    if seat is not None:
        StaffAccount.objects.filter(user=seat).delete()
        if seat.is_staff:
            seat.is_staff = False
            seat.save(update_fields=['is_staff'])

    wiped = AdminSetting.objects.filter(key__in=WORDING + COIN_DESK + REACH_DESK + WATCH_DESK).delete()[0]
    # An alert the last run acknowledged comes back from the next scan still
    # acknowledged, and a pulse the seed stamped is read as "already heard of"
    # forever. Both tables belong to the console rather than to the site, so both go
    # back to nothing and the safety screens are judged on what they derive now.
    watched = sum(AdminAlert.objects.all().delete()[1].values()) \
        + sum(AdminPulse.objects.all().delete()[1].values())
    unwrote = 0
    for gap_verb in LOG_GAPS:
        unwrote += AuditLog.objects.filter(action__startswith=gap_verb).delete()[0]

    print(f'cleared the admin seat for {OWNER}; {SEAT} is back to an ordinary account.')
    print(f'took back {wiped} wording line(s), coin-desk number(s), reach dial(s) and '
          f'safety/limit knob(s) the walkthrough wrote.')
    print(f'tore down {watched} alert row(s) and outside-reporter stamp(s), and unwrote '
          f'{unwrote} alert/export row(s) from the log the next run reads as a gap.')
    print('sign-in attempts are limited to 8 per minute per address, so leave a minute before a re-run.')


if __name__ == '__main__':
    main()
