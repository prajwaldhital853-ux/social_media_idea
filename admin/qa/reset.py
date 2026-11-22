"""Reset the two seats the console walkthrough plays with, and the wording it rewrote.

`admin/qa/console.mjs` verifies a *first* sign-in, so both accounts have to start
out with no authenticator. Only those two rows are touched: the demo Client
account loses its admin seat record, and the throwaway Moderator account
(`moddemo`, created for this suite) loses its seat and its staff flag. The three
platform settings section 9 types over go back to the file defaults, so the demo
site is never left quoting a QA sentence. Nothing else in the database is read or
written, and the main site's own accounts, sessions and profiles are left exactly
as they are.

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
from apps.adminpanel.models import AdminSetting, StaffAccount  # noqa: E402

OWNER = 'sita'
SEAT = 'moddemo'
# The lines section 9 of the walkthrough writes from the welcome desk.
WORDING = ('welcome_message', 'tagline', 'contact_phone')


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

    wiped = AdminSetting.objects.filter(key__in=WORDING).delete()[0]

    print(f'cleared the admin seat for {OWNER}; {SEAT} is back to an ordinary account.')
    print(f'took back {wiped} first-load wording line(s) the walkthrough wrote.')
    print('sign-in attempts are limited to 8 per minute per address, so leave a minute before a re-run.')


if __name__ == '__main__':
    main()
