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
    # Set when the console wrote the first password. The seat cannot get past the
    # door until the person behind it has replaced it with one only they know: a
    # password read out over the phone is not a secret, and it is in the audit log.
    must_change_password = models.BooleanField(default=False)

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


class PolicyTerm(models.Model):
    """A word, a link or a thing this platform will not carry, and who said so.

    Three kinds on one table because they are managed the same way and read by the
    same screens: a blocked word is matched against text, a blocked link is matched
    against what a post points at, a prohibited item is a line a moderator quotes
    when deciding a listing. All three are stored lowercase because a list that
    distinguishes `Firearm` from `firearm` quietly stops matching half of what it
    is supposed to.
    """

    class Kind(models.TextChoices):
        WORD = 'word', 'Blocked word'
        ITEM = 'item', 'Prohibited item'
        LINK = 'link', 'Blocked link'

    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.WORD)
    text = models.CharField(max_length=80)
    note = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='policy_terms_written',
    )

    class Meta:
        ordering = ['kind', 'text']
        constraints = [
            models.UniqueConstraint(fields=['kind', 'text'], name='policy_term_once'),
        ]

    def __str__(self):
        return f'{self.kind}: {self.text}'


class PolicyCategory(models.Model):
    """The marketplace's shelf labels, in a table so the list is not a deploy.

    `Listing.category` in the main app is free text, which is why a category can
    be spelled four ways on the marketplace today. This is the vocabulary the
    console offers and checks against; the rows are ordered because a person
    browsing sells by what is at the top of the list.
    """

    name = models.CharField(max_length=80, unique=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='policy_categories_written',
    )

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name


class PublicNotice(models.Model):
    """A moderation outcome the community is told about, not only the person it
    was done to.

    Kept as its own row rather than a notification: a private warning disappears
    into the bell, while this is a statement that stays attached to the content
    or the account it is about, and can be withdrawn — which is its own audited
    decision.
    """

    class Target(models.TextChoices):
        POST = 'post', 'Post'
        COMMENT = 'comment', 'Comment'
        LISTING = 'listing', 'Listing'
        USER = 'user', 'Account'

    target_type = models.CharField(max_length=10, choices=Target.choices)
    target_id = models.CharField(max_length=64)
    about = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='public_notices',
    )
    text = models.CharField(max_length=240)
    reason = models.CharField(max_length=120, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='notices_posted',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    is_live = models.BooleanField(default=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['target_type', 'target_id'], name='notice_on_content'),
            models.Index(fields=['is_live', '-created_at'], name='notice_live_newest'),
        ]

    def __str__(self):
        return f'notice {self.target_type}:{self.target_id}'


class CoinReview(models.Model):
    """What the console did about a coin purchase, and why.

    `wallet.CoinRequest` is the member site's table and holds only the payer's half
    of the story, so the staff half — the sentence a rejection was made with, how
    many coins were actually credited, which seat signed it — is kept here. One row
    per action rather than a column per verdict, because a request can be asked for
    more proof twice before anyone approves it, and overwriting the first ask would
    lose the date the person was told.
    """

    class Action(models.TextChoices):
        APPROVE = 'approve', 'Approved'
        REJECT = 'reject', 'Rejected'
        PROOF = 'proof', 'Asked for more proof'

    request = models.ForeignKey('wallet.CoinRequest', on_delete=models.CASCADE, related_name='admin_reviews')
    action = models.CharField(max_length=8, choices=Action.choices)
    reason = models.CharField(max_length=240, blank=True)
    coins_credited = models.PositiveIntegerField(default=0)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='coin_reviews_written',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['request', '-created_at'], name='coin_review_recent')]

    def __str__(self):
        return f'{self.action} request {self.request_id}'


class PromoReview(models.Model):
    """What the console decided about one paid campaign, and what it cost.

    `promotions.Promotion` is the member site's table and only holds the payer's
    half of the story — the budget, the targeting, the counters. The staff half is
    kept here: the sentence a rejection was made with, how many coins actually went
    back, whether the Admin chose to refund or to withhold on a stop, and which seat
    signed it. One row per action, because a campaign gets paused and resumed several
    times before anyone ends it, and the last click is not the whole history.
    """

    class Action(models.TextChoices):
        APPROVE = 'approve', 'Approved'
        REJECT = 'reject', 'Rejected'
        PAUSE = 'pause', 'Paused'
        RESUME = 'resume', 'Resumed'
        STOP = 'stop', 'Stopped'

    class Choice(models.TextChoices):
        CREDIT = 'credit', 'Refunded'
        WITHHOLD = 'withhold', 'Withheld'

    promotion = models.ForeignKey('promotions.Promotion', on_delete=models.CASCADE, related_name='admin_reviews')
    action = models.CharField(max_length=8, choices=Action.choices)
    reason = models.CharField(max_length=240, blank=True)
    coins_refunded = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    choice = models.CharField(max_length=9, choices=Choice.choices, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='promo_reviews_written',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['promotion', '-created_at'], name='promo_review_recent')]

    def __str__(self):
        return f'{self.action} campaign {self.promotion_id}'


class AdminPulse(models.Model):
    """One thing that happens outside these tables, and the last time it said so.

    A backup, a video transcoder, an uptime probe and an error collector cannot be
    read out of Postgres, so they report in here —
    `python manage.py adminpulse backup --state=ok`. `alerts.scan()` then tells the
    three silences apart, because they mean three different things: never heard of
    (nobody wired this up yet), heard of and gone quiet (the job stopped), and heard
    of and reporting trouble. A row is only ever stamped, never deleted, so "when did
    we last hear from the backups" stays answerable months later.
    """

    class State(models.TextChoices):
        OK = 'ok', 'Healthy'
        WARN = 'warn', 'Warned'
        FAIL = 'fail', 'Failing'

    key = models.CharField(max_length=40, unique=True)
    label = models.CharField(max_length=80)
    state = models.CharField(max_length=5, choices=State.choices, default=State.OK)
    detail = models.CharField(max_length=240, blank=True)
    # Whatever the reporter counted, as it counted it: `{'waiting': 41}`. Kept as
    # JSON because a backlog, a backup size and an error rate have nothing in common
    # except the number each of them is worried about.
    counts = models.JSONField(default=dict, blank=True)
    stamped_at = models.DateTimeField(default=timezone.now)
    stamps = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ['key']

    def __str__(self):
        return f'{self.key} {self.state} at {self.stamped_at:%Y-%m-%d %H:%M}'
