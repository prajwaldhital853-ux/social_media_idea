"""RFC 6238 TOTP — the algorithm Google Authenticator, Authy and 1Password speak.

Handed the two-factor requirement for staff logins without adding a package to a
requirements.txt that three other agents are editing. RFC 6238 is HMAC-SHA1 over a
counter, and `hmac` is already in the standard library; the test suite checks it
against the vectors in Appendix B of the RFC, so "hand-rolled" is not "unverified".
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time

PERIOD = 30
DIGITS = 6
# One step either way. A phone whose clock is a minute adrift must still get in,
# and a two-step window still leaves a 6-digit guess at roughly 1 in 500,000.
WINDOW = 1

_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'


def new_secret():
    """160-bit base32 secret, unpadded — the same shape pyotp hands out."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def normalize_secret(secret):
    """Tidy what a human pasted: spaces stripped, case folded, padding restored."""
    raw = ''.join((secret or '').split()).upper().rstrip('=')
    if not raw:
        raise ValueError('Empty TOTP secret.')
    if any(ch not in _ALPHA for ch in raw):
        raise ValueError('Not a base32 TOTP secret.')
    return raw + '=' * (-len(raw) % 8)


def _decode(secret):
    return base64.b32decode(normalize_secret(secret), casefold=True)


def hotp(secret_bytes, counter, digits=DIGITS):
    digest = hmac.new(secret_bytes, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10 ** digits)).zfill(digits)


def totp(secret, at=None, digits=DIGITS, period=PERIOD):
    key = _decode(secret)
    seconds = int(time.time() if at is None else at.timestamp())
    return hotp(key, seconds // period, digits)


def verify(secret, code, at=None, digits=DIGITS, period=PERIOD, window=WINDOW):
    """Constant-time check across the window, tolerating either digit length."""
    candidate = ''.join((code or '').split()).upper().rstrip('\n')
    if not candidate.isdigit():
        return False
    key = _decode(secret)
    seconds = int(time.time() if at is None else at.timestamp())
    step = seconds // period
    for offset in range(-window, window + 1):
        # HOTP's counter is an unsigned 64-bit integer, so the step before the
        # epoch does not exist — only a test clock at 00:00:00 can reach it.
        if step + offset < 0:
            continue
        # Authenticator apps show 6; the RFC vectors are 8. Accept either width so
        # a pasted 8-digit code from another tool is not read as a wrong password.
        for width in {DIGITS, digits}:
            if hmac.compare_digest(hotp(key, step + offset, width), candidate.zfill(width)):
                return True
    return False
