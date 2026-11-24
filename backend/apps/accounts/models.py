from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.functions import Upper


class User(AbstractUser):
    date_of_birth = models.DateField(null=True, blank=True)
    country = models.CharField(max_length=80, blank=True)
    city = models.CharField(max_length=80, blank=True)
    provider = models.CharField(max_length=10, default='email')
    email_verified = models.BooleanField(default=False)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    suspended_until = models.DateTimeField(null=True, blank=True)
    suspend_reason = models.CharField(max_length=200, blank=True)
    # Where this account last came in from. The device can be banned with the
    # account; the IP is kept for staff visibility and deliberate network bans only.
    last_ip = models.CharField(max_length=60, blank=True)
    last_device = models.CharField(max_length=80, blank=True)
    # Stamped by seed_demo on every account it owns. The purge in that command may
    # delete only these rows, which is what makes it survivable as a deploy step.
    seeded = models.BooleanField(default=False)

    class Meta:
        # Every way in looks an address up with `email__iexact`, which Postgres
        # answers as `UPPER(email::text) = UPPER(...)`. A plain index on the column
        # cannot serve that expression, so each sign-in read the whole table; these
        # two match the expression the queries actually produce.
        indexes = [
            models.Index(Upper('email'), name='user_email_upper'),
            models.Index(Upper('username'), name='user_username_upper'),
        ]

    @property
    def is_locked(self):
        from django.utils import timezone
        return bool(self.locked_until and self.locked_until > timezone.now())

    @property
    def is_suspended(self):
        from django.utils import timezone
        return bool(self.suspended_until and self.suspended_until > timezone.now())

    def save(self, *args, **kwargs):
        # One shape for the address, everywhere. Signup already trims and lowercases;
        # an admin edit or a scripted import does not, and an account stored as
        # "Foo@Gmail.com" answering to "foo@gmail.com" is indistinguishable from a
        # deleted one.
        self.email = (self.email or '').strip().lower()
        super().save(*args, **kwargs)


class RefreshSession(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='refresh_sessions')
    jti = models.CharField(max_length=64, unique=True)
    device_id = models.CharField(max_length=80, blank=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', '-created_at'], name='refresh_user_recent'),
            # The nightly purge deletes by expiry alone.
            models.Index(fields=['expires_at'], name='refresh_expires'),
        ]


class DeviceTrust(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='trusted_devices')
    device_id = models.CharField(max_length=80)
    label = models.CharField(max_length=160, blank=True)
    trusted_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'device_id'], name='one_trust_per_user_device')]


class EmailOTP(models.Model):
    PURPOSES = [
        ('login', 'New device login'), ('unlock', 'Account unlock'),
        ('verify', 'Email verification'), ('delete', 'Account deletion'),
        ('reset', 'Password reset'), ('admin_reset', 'Staff password reset'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='otps')
    # A staff code is a different key than a member code: `admin_reset` has to be
    # longer than ten characters, and one door must never be able to spend the
    # other door's letter.
    purpose = models.CharField(max_length=12, choices=PURPOSES)
    code_hash = models.CharField(max_length=64)
    device_id = models.CharField(max_length=80, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', 'purpose', '-created_at'], name='otp_user_purpose_recent'),
            models.Index(fields=['expires_at'], name='otp_expires'),
        ]


class PasswordHistory(models.Model):
    """The last few hashes an account has stood on.

    A reset that lands back on the password the account already used is a reset
    that changed nothing, and the person who typed it believes they are safe.
    Only the hash is kept — the same one the account row holds — because a door
    can ask "is this that word again" without ever being able to read it back.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='password_hashes')
    password_hash = models.CharField(max_length=255)
    set_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-set_at']
        indexes = [models.Index(fields=['user', '-set_at'], name='password_hist_user_recent')]


class AuthBan(models.Model):
    """A way into the service that is closed, and until when.

    The lockout used to live only on the User row, so three wrong passwords closed
    one door and left the others open: the same person signed up again, or took the
    Google door on the very address that had just locked — which then cleared its own
    counter. A password trip writes rows for the address and browser, and every way
    in reads them before it looks at a credential. IP rows are for deliberate staff
    bans, never automatic password lockouts on a shared connection.
    """

    SCOPES = [('email', 'Email address'), ('ip', 'Connection'), ('device', 'Device')]
    REASONS = [('lock', 'Wrong passwords'), ('admin', 'Staff action'), ('manual', 'Manual ban')]

    scope = models.CharField(max_length=8, choices=SCOPES)
    value = models.CharField(max_length=190)
    # The account responsible for this ban, so lifting its password lock does not
    # lift a separate staff decision covering the same browser.
    identity = models.CharField(max_length=190, blank=True)
    reason = models.CharField(max_length=8, choices=REASONS, default='lock')
    until = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['scope', 'value', '-created_at'], name='ban_scope_value_recent'),
            # An unlock lifts every row raised for one account, and `lift()` is the
            # only reader of `identity` — without this it scans the whole ban table.
            models.Index(fields=['identity'], name='ban_identity'),
        ]

    @property
    def active(self):
        from django.utils import timezone
        return self.until > timezone.now()