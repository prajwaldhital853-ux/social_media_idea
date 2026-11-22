from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from . import totp
from .tokens import decrypt_secret, encrypt_secret

TOTP_LOCK_AFTER = 5
TOTP_LOCK_MINUTES = 15
PASSWORD_LOCK_AFTER = 5
PASSWORD_LOCK_MINUTES = 15


class StaffAccount(models.Model):
    """The client's staff roster: which role a person holds, what they may open,
    and whether they have proved a second factor for this console.

    One row per staff member, created on first use so an account that already
    carries `is_staff` in the main app becomes administrable without a data
    migration. `role` is authoritative except for a superuser, who is always the
    Client: a mis-clicked dropdown must never lock the owner out of the console.
    """

    class Role(models.TextChoices):
        SUPERADMIN = 'superadmin', 'Superadmin'
        ADMIN = 'admin', 'Admin'
        MODERATOR = 'moderator', 'Moderator'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='staff_account',
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MODERATOR)
    is_enabled = models.BooleanField(default=True)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='staff_grants_made',
    )
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    # A moderator's explicit allow/deny lists, on top of whatever the role grants.
    granted_keys = models.JSONField(default=list, blank=True)
    denied_keys = models.JSONField(default=list, blank=True)

    # Second factor. Only ever the encrypted form is stored; the plaintext secret
    # exists for the seconds it takes to render the enrolment QR.
    totp_secret = models.TextField(blank=True)
    totp_enrolled_at = models.DateTimeField(null=True, blank=True)
    totp_failed = models.PositiveSmallIntegerField(default=0)
    totp_locked_until = models.DateTimeField(null=True, blank=True)
    recovery_codes = models.JSONField(default=list, blank=True)

    last_admin_login_at = models.DateTimeField(null=True, blank=True)
    login_failed = models.PositiveSmallIntegerField(default=0)
    login_locked_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-granted_at']
        indexes = [models.Index(fields=['role', 'is_enabled'], name='staff_roster')]

    def __str__(self):
        return f'{self.user.username} ({self.effective_role})'

    @property
    def secret(self):
        return decrypt_secret(self.totp_secret)

    @property
    def effective_role(self):
        if self.user.is_superuser:
            return StaffAccount.Role.SUPERADMIN
        return self.role

    @property
    def is_enrolled(self):
        return bool(self.totp_enrolled_at and self.secret)

    @property
    def is_locked(self):
        return bool(self.totp_locked_until and self.totp_locked_until > timezone.now())

    @property
    def is_login_locked(self):
        return bool(self.login_locked_until and self.login_locked_until > timezone.now())

    @classmethod
    def for_user(cls, user):
        """The roster row, created on the spot if this staff member is new here."""
        row, _ = cls.objects.get_or_create(user=user)
        return row

    def provision_secret(self):
        """Start enrolment over: a fresh secret, no recovery codes left standing."""
        self.totp_secret = encrypt_secret(totp.new_secret())
        self.totp_enrolled_at = None
        self.totp_failed = 0
        self.totp_locked_until = None
        self.recovery_codes = []
        self.save(update_fields=[
            'totp_secret', 'totp_enrolled_at', 'totp_failed', 'totp_locked_until', 'recovery_codes',
        ])
        return self.secret

    def confirm_enrolment(self, codes):
        self.totp_enrolled_at = timezone.now()
        self.totp_failed = 0
        self.totp_locked_until = None
        self.recovery_codes = list(codes)
        self.save(update_fields=['totp_enrolled_at', 'totp_failed', 'totp_locked_until', 'recovery_codes'])

    def note_totp_failure(self):
        self.totp_failed += 1
        if self.totp_failed >= TOTP_LOCK_AFTER:
            self.totp_locked_until = timezone.now() + timedelta(minutes=TOTP_LOCK_MINUTES)
        self.save(update_fields=['totp_failed', 'totp_locked_until'])

    def note_totp_success(self):
        if self.totp_failed or self.totp_locked_until:
            self.totp_failed = 0
            self.totp_locked_until = None
            self.save(update_fields=['totp_failed', 'totp_locked_until'])

    def note_login_failure(self):
        self.login_failed += 1
        if self.login_failed >= PASSWORD_LOCK_AFTER:
            self.login_locked_until = timezone.now() + timedelta(minutes=PASSWORD_LOCK_MINUTES)
        self.save(update_fields=['login_failed', 'login_locked_until'])

    def note_login_success(self):
        self.login_failed = 0
        self.login_locked_until = None
        self.last_admin_login_at = timezone.now()
        self.save(update_fields=['login_failed', 'login_locked_until', 'last_admin_login_at'])

    def burn_recovery(self, index):
        """Single-use, so a leaked sheet cannot be replayed after it is spent."""
        remaining = [code for i, code in enumerate(self.recovery_codes) if i != index]
        self.recovery_codes = remaining
        self.totp_failed = 0
        self.totp_locked_until = None
        self.save(update_fields=['recovery_codes', 'totp_failed', 'totp_locked_until'])
        return len(remaining)


class AdminSetting(models.Model):
    """One knob the console turns, as a keyed text row.

    A table rather than one JSON blob because each section owns its own keys: two
    screens writing settings never overwrite each other's, and a value can be
    audited back to the person who set it. Text on purpose — Postgres would want
    a column per type otherwise, and `settings_store` casts against the default
    it knows, so a row that cannot parse falls back rather than 500-ing a screen.
    """

    key = models.CharField(max_length=60, unique=True)
    value = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='settings_written',
    )

    def __str__(self):
        return f'{self.key}={self.value}'


class AdminAlert(models.Model):
    """Something the platform wants a person to look at, and what became of it.

    Rows are raised by `alerts.scan()` from live state and deduped on `key`, so a
    report pile that keeps growing updates one alert instead of filling the feed —
    `occurrences` is where that repeats. A resolved row is kept, never deleted:
    the contract asks for the full alert history, and "did anyone see it" is a
    question asked weeks later.
    """

    class Severity(models.TextChoices):
        INFO = 'info', 'Info'
        WARNING = 'warning', 'Warning'
        CRITICAL = 'critical', 'Critical'

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        ACKED = 'acked', 'Acknowledged'
        RESOLVED = 'resolved', 'Resolved'

    key = models.CharField(max_length=120, unique=True)
    kind = models.CharField(max_length=40)
    severity = models.CharField(max_length=8, choices=Severity.choices, default=Severity.WARNING)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN)
    title = models.CharField(max_length=160)
    detail = models.CharField(max_length=240, blank=True)
    # The console screen that clears this, so an alert is a link and not a chore.
    href = models.CharField(max_length=80, blank=True)
    context = models.JSONField(default=dict, blank=True)
    occurrences = models.PositiveIntegerField(default=1)
    first_seen = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    acked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='alerts_acked',
    )

    class Meta:
        ordering = ['-last_seen']
        indexes = [models.Index(fields=['status', '-last_seen'], name='alert_open_newest')]

    def __str__(self):
        return f'{self.kind} ({self.status})'
