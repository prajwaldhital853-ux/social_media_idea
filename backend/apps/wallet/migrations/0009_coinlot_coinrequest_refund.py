import decimal

import django.db.models.deletion
from django.db import migrations, models


def backfill_lots(apps, schema_editor):
    """Give every purchase that was already credited a batch of its own.

    A lot only exists from this migration on, so a refund door that opened solely for
    purchases made afterwards would strand every approved purchase sitting on an
    account today. What cannot be re-derived is how much of an old batch was spent, so
    the honest lower bound is used: the batch is credited with as many coins as the
    wallet still holds. A wallet with fewer coins than that purchase gave it has, by
    definition, spent part of it, and its door stays shut.
    """
    CoinRequest = apps.get_model('wallet', 'CoinRequest')
    CoinLot = apps.get_model('wallet', 'CoinLot')
    Wallet = apps.get_model('wallet', 'Wallet')
    wallets = {wallet.user_id: wallet for wallet in Wallet.objects.all()}
    rows = []
    for req in CoinRequest.objects.filter(status='approved'):
        wallet = wallets.get(req.user_id)
        if wallet is None:
            continue
        coins = decimal.Decimal(req.coins)
        rows.append(CoinLot(
            wallet_id=wallet.pk, request_id=req.pk, coins=coins,
            remaining=min(coins, wallet.balance), held=decimal.Decimal('0'),
        ))
    CoinLot.objects.bulk_create(rows, batch_size=500)


def drop_backfilled_lots(apps, schema_editor):
    apps.get_model('wallet', 'CoinLot').objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0008_ledger_purge_flag'),
    ]

    operations = [
        migrations.AddField(
            model_name='coinrequest',
            name='refund_requested_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='coinrequest',
            name='refund_reference',
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name='coinrequest',
            name='refund_screenshot_url',
            field=models.URLField(blank=True),
        ),
        migrations.AddField(
            model_name='coinrequest',
            name='refund_reason',
            field=models.CharField(blank=True, max_length=240),
        ),
        migrations.AddField(
            model_name='coinrequest',
            name='refunded_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='coinrequest',
            name='status',
            field=models.CharField(
                choices=[('pending', 'Pending'), ('approved', 'Approved'),
                         ('rejected', 'Rejected'), ('refunded', 'Refunded')],
                default='pending', max_length=10,
            ),
        ),
        migrations.CreateModel(
            name='CoinLot',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('coins', models.DecimalField(max_digits=12, decimal_places=2)),
                ('remaining', models.DecimalField(max_digits=12, decimal_places=2)),
                ('held', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('request', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                                 related_name='lot', to='wallet.coinrequest')),
                ('wallet', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                             related_name='coin_lots', to='wallet.wallet')),
            ],
            options={
                'ordering': ['created_at', 'id'],
            },
        ),
        migrations.AddIndex(
            model_name='coinlot',
            index=models.Index(fields=['wallet', 'created_at'], name='coin_lot_oldest'),
        ),
        migrations.RunPython(backfill_lots, drop_backfilled_lots),
    ]
