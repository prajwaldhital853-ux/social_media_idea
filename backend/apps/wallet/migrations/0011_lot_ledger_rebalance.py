import decimal

from django.db import migrations


def rebalance_lots(apps, schema_editor):
    """Give every batch back the coins the double draw took from it twice.

    `settle()` wrote the refunded batch down and then handed the same number to
    `apply()`, which eats the oldest free lot on every debit, so each paid refund
    closed two batches while the balance only dropped by one. Purchases nobody had
    spent were left holding nothing, and their refund door told the member they had
    spent them.

    The rows cannot say which batch a real spend came from once they are wrong, so
    this rebuilds them the way the code was always meant to: a purchase that was paid
    back is closed for good, every other batch starts whole, and only what the wallet
    is genuinely short by is eaten again, oldest first. A wallet whose batches already
    add up is rebuilt to exactly what it holds, so this is safe to run over correct
    rows too. Coins a refund still has its hand on stay held, because that ask is open.
    """
    CoinLot = apps.get_model('wallet', 'CoinLot')
    CoinRequest = apps.get_model('wallet', 'CoinRequest')
    Wallet = apps.get_model('wallet', 'Wallet')

    zero = decimal.Decimal('0')
    paid = set(CoinRequest.objects.filter(refunded_at__isnull=False).values_list('pk', flat=True))

    for wallet in Wallet.objects.all():
        lots = list(CoinLot.objects.filter(wallet=wallet).order_by('created_at', 'id'))
        if not lots:
            continue
        for lot in lots:
            lot.remaining = zero if lot.request_id in paid else lot.coins
        short = sum((lot.remaining for lot in lots), zero) - wallet.balance
        if short > zero:
            for lot in lots:
                if short <= zero:
                    break
                free = lot.remaining - lot.held
                if free <= zero:
                    continue
                take = min(free, short)
                lot.remaining = lot.remaining - take
                short -= take
        for lot in lots:
            CoinLot.objects.filter(pk=lot.pk).update(remaining=lot.remaining)


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0010_coinrequest_refund_refused'),
    ]

    operations = [
        migrations.RunPython(rebalance_lots, migrations.RunPython.noop),
    ]
