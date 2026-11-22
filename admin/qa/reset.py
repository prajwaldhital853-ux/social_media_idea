"""Reset the two seats the console walkthrough plays with.

`admin/qa/console.mjs` verifies a *first* sign-in, so both accounts have to start
out with no authenticator. Only those two rows are touched: the demo Client
account loses its admin seat record, and the throwaway Moderator account
(`moddemo`, created for this suite) loses its seat and its staff flag. Nothing
else in the database is read or written, and the main site's own accounts,
sessions and profiles are left exactly as they are.

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
from apps.adminpanel.models import StaffAccount  # noqa: E402

OWNER = 'sita'
SEAT = 'moddemo'


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

    print(f'cleared the admin seat for {OWNER}; {SEAT} is back to an ordinary account.')
    print('sign-in attempts are limited to 8 per minute per address, so leave a minute before a re-run.')


if __name__ == '__main__':
    main()
