from django.contrib.auth.models import AbstractUser
from django.db import models


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
    # Stamped by seed_demo on every account it owns. The purge in that command may
    # delete only these rows, which is what makes it survivable as a deploy step.
    seeded = models.BooleanField(default=False)

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
        indexes = [models.Index(fields=['user', '-created_at'], name='refresh_user_recent')]


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
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='otps')
    purpose = models.CharField(max_length=10, choices=PURPOSES)
    code_hash = models.CharField(max_length=64)
    device_id = models.CharField(max_length=80, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['user', 'purpose', '-created_at'], name='otp_user_purpose_recent')]