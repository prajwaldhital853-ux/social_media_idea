"""The password work factor this deployment can actually afford.

Django 6 ships PBKDF2-SHA256 at 1,500,000 iterations, a number calibrated for
the hardware it was measured on. Measured here, one verify costs 3.4 seconds —
and a verify is the first thing every visitor does, on the sign-in form and on
every sign-up. The deployed instance is a half-core, so it is not faster.

The work factor below costs about 0.7s on the same machine, which is the value
Django shipped in 4.0. Old hashes are not touched: they stay in
PASSWORD_HASHERS, still verify, and the login view writes the new digest down
the first time the owner proves the password, so accounts migrate one login at
a time instead of all at once by re-seeding.
"""

from django.contrib.auth.hashers import PBKDF2PasswordHasher


class WorkFactorPasswordHasher(PBKDF2PasswordHasher):
    iterations = 320_000
