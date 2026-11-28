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
        REFUNDED = 'refunded', 'Refunded'

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
    # The refund half of the same purchase. The coins stay on the request the buyer
    # paid for: a refund is a chapter of that purchase, not a second one, and one
    # row keeps the desk's paper in the place it already looks.
    refund_requested_at = models.DateTimeField(null=True, blank=True)
    refund_reference = models.CharField(max_length=80, blank=True)
    refund_screenshot_url = models.URLField(blank=True)
    refund_reason = models.CharField(max_length=240, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    # The desk read the ask and said no. The coins come off the lock, the purchase
    # stays approved, and this stamp is what turns the buyer's badge from "waiting"
    # into the answer without a sixth status that means the same thing twice.
    refund_refused_at = models.DateTimeField(null=True, blank=True)
    refund_refuse_reason = models.CharField(max_length=240, blank=True)

    class Meta:
        ordering = ['-created_at']
        # The console opens on the pending pile, and the member's own history is
        # read by user — neither could use the natural `-created_at` ordering alone.
        indexes = [
            models.Index(fields=['status', '-created_at'], name='coins_status_newest'),
            models.Index(fields=['user', '-created_at'], name='coins_user_newest'),
        ]


class CoinLot(models.Model):
    """The coins from one approved purchase, and what is left of them.

    A refund is only honest if the platform can say "not one of these coins has been
    spent", and a balance alone cannot answer that because coins pool the moment they
    land. So every approval writes a lot, every debit eats the oldest free lot first,
    and a lot can be held — a hold is money the buyer asked back and the desk has not
    paid yet. A wallet funded before this table existed simply has no lot rows, and
    its coins move exactly as they always did.
    """

    wallet = models.ForeignKey(Wallet, on_delete=models.CASCADE, related_name='coin_lots')
    request = models.OneToOneField(CoinRequest, on_delete=models.CASCADE, related_name='lot')
    coins = models.DecimalField(max_digits=12, decimal_places=2)
    remaining = models.DecimalField(max_digits=12, decimal_places=2)
    held = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [models.Index(fields=['wallet', 'created_at'], name='coin_lot_oldest')]

    @property
    def untouched(self):
        """Not one coin of this purchase has been spent."""
        return self.remaining >= self.coins

    def __str__(self):
        return f'{self.remaining}/{self.coins} from request {self.request_id}'


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
        lots = []
        if kind == Transaction.Kind.DEBIT:
            lots = list(CoinLot.objects.select_for_update().filter(wallet=wallet).order_by('created_at', 'id'))
            held = _held(lots)
            if amount > wallet.balance - held:
                raise ValueError(
                    f'{_whole(held)} of this wallet\'s {_whole(wallet.balance)} coins are locked for a '
                    f'refund that was asked for and not yet paid, so at most '
                    f'{_whole(wallet.balance - held)} coins can be spent.'
                )
        Wallet.objects.filter(pk=wallet.pk).update(balance=F('balance') + delta)
        if kind == Transaction.Kind.DEBIT:
            _consume(lots, amount)
        row = Transaction.objects.create(wallet=wallet, kind=kind, amount=amount,
                                         note=note[:200], actor=actor, ref=str(ref or '')[:80])
    _pulse_balance(wallet.user_id, wallet.pk)
    return row


def _held(lots):
    return sum((lot.held for lot in lots), Decimal('0'))


def _whole(value):
    """A coin count without the trailing `.00`, which is how a person counts coins."""
    number = Decimal(value)
    return int(number) if number == number.to_integral_value() else number


def _consume(lots, amount):
    """Eat the oldest coins that no refund has its hand on.

    The order is the whole point: a purchase stays refundable only while it is
    untouched, so a buyer who spends anything spends their oldest coins first and
    the batch they might want back is the one left intact.
    """
    left = amount
    for lot in lots:
        if left <= 0:
            return
        free = lot.remaining - lot.held
        if free <= 0:
            continue
        take = min(free, left)
        lot.remaining = lot.remaining - take
        CoinLot.objects.filter(pk=lot.pk).update(remaining=lot.remaining)
        left -= take


def credit_purchase(wallet, req, actor=None):
    """Rupees approved, coins in: the ledger row and the batch it belongs to.

    Every door that credits an approved purchase comes through here, so a lot always
    exists beside an approval and the refund question has something to answer from.
    """
    entry = apply(wallet.pk, Transaction.Kind.CREDIT, req.coins,
                  f'Coin purchase {req.pk} approved',
                  actor=actor, ref=req.reference or f'coin_request:{req.pk}')
    CoinLot.objects.get_or_create(
        request=req, defaults={'wallet_id': wallet.pk, 'coins': Decimal(req.coins),
                               'remaining': Decimal(req.coins)},
    )
    return entry


def locked_coins(wallet_id, except_request=None):
    """What the refund desk is currently holding this wallet's coins for."""
    qs = CoinLot.objects.filter(wallet_id=wallet_id)
    if except_request is not None:
        qs = qs.exclude(request_id=except_request)
    return _held(list(qs))


def _pulse_balance(user_id, wallet_id):
    """The new balance, told to the one tab that shows it, the moment it moved.

    Emitted after the ledger's transaction commits, so the number a frame
    carries is a number the account can already see in the API.
    """
    transaction.on_commit(lambda: _send_balance(user_id, wallet_id))


def _send_balance(user_id, wallet_id):
    from apps.common import pulse

    fresh = Wallet.objects.filter(pk=wallet_id).values_list('balance', flat=True).first()
    if fresh is None:
        return
    pulse.to_user(user_id, 'coins', balance=fresh)
    pulse.to_staff('coins', user_id=user_id, balance=fresh)


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