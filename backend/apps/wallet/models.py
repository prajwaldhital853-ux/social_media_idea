from contextlib import contextmanager
from decimal import Decimal

from django.conf import settings
from django.db import connection, models, transaction
from django.db.models import F


class Wallet(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='wallet')
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default='NPR')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user.username}: {self.balance} {self.currency}'


class Transaction(models.Model):
    """Append-only ledger: rows are never updated or deleted."""

    class Kind(models.TextChoices):
        CREDIT = 'credit', 'Credit'
        DEBIT = 'debit', 'Debit'

    wallet = models.ForeignKey(Wallet, on_delete=models.CASCADE, related_name='transactions')
    kind = models.CharField(max_length=6, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=200, blank=True)
    # The seat that moved the money, separate from the words on the row so an
    # audit never has to parse a sentence to learn a name. Empty on rows no staff
    # seat caused. A departed staff member's row survives with the name gone.
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                              on_delete=models.SET_NULL, related_name='ledger_rows')
    # What the money was for, as a token a report can group on: the payer's own
    # transaction reference on a deposit, `coin_request:<pk>`, `promotion:<pk>`,
    # `manual` on a hand-written row.
    ref = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['wallet', '-created_at'], name='ledger_wallet_recent')]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValueError('Ledger entries are append-only.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Ledger entries are append-only.')

    def __str__(self):
        return f'{self.kind} {self.amount} ({self.wallet_id})'


class CoinRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='coin_requests')
    coins = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=20, default='qr')
    reference = models.CharField(max_length=80, blank=True)
    screenshot_url = models.URLField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # When the buyer last answered a request for more proof. The ask itself lives
    # in the review rows, so this stamp is only the waterline: an ask older than
    # this has been answered, and a new ask writes a review after it and re-opens
    # the banner. The request row is updated in place — resubmitting never makes
    # a second purchase the admin then has to reconcile with the first.
    resubmitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        # The console opens on the pending pile, and the member's own history is
        # read by user — neither could use the natural `-created_at` ordering alone.
        indexes = [
            models.Index(fields=['status', '-created_at'], name='coins_status_newest'),
            models.Index(fields=['user', '-created_at'], name='coins_user_newest'),
        ]


class DeletedWalletRecord(models.Model):
    """The money record of a deleted account, kept after the cascade takes the rest.

    Deleting a member destroys the wallet and every row in it, so the whole money
    history is copied here first: every movement, every coin request with its
    approval history, every campaign with its refund decisions, staff names kept
    as text. The archive holds no foreign keys, so nothing in it can keep the
    account alive or be broken by its departure — it is the paper a dispute is
    settled from after the person it belonged to is gone.
    """

    username = models.CharField(max_length=150, unique=True)
    record = models.JSONField()
    archived_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-archived_at']

    def __str__(self):
        return f'{self.username} ({self.archived_at:%Y-%m-%d})'


def apply(wallet_id, kind, amount, note='', actor=None, ref=''):
    """Atomic balance change + ledger row. Raises ValueError on overdraft."""
    amount = Decimal(amount)
    if amount <= 0:
        raise ValueError('Amount must be positive.')
    with transaction.atomic():
        wallet = Wallet.objects.select_for_update().get(pk=wallet_id)
        delta = amount if kind == Transaction.Kind.CREDIT else -amount
        if wallet.balance + delta < 0:
            raise ValueError('Insufficient balance.')
        Wallet.objects.filter(pk=wallet.pk).update(balance=F('balance') + delta)
        return Transaction.objects.create(wallet=wallet, kind=kind, amount=amount,
                                          note=note[:200], actor=actor, ref=str(ref or '')[:80])


@contextmanager
def purging_ledger():
    """Allow the wrapped cascade to delete ledger rows, and nothing else.

    The database trigger behind the append-only guarantee rejects every UPDATE,
    and every DELETE the transaction did not explicitly ask for. Only the
    account-deletion cascades may remove rows — the money record is copied to
    the archive first — and SET LOCAL dies with the transaction it was set in,
    so the permission can never outlive the delete it was granted to.
    """
    with transaction.atomic():
        cursor = connection.cursor()
        cursor.execute("SET LOCAL exposing.ledger_purge = 'on'")
        cursor.close()
        yield