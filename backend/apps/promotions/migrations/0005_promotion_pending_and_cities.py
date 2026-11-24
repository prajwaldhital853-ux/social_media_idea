from django.db import migrations, models


def answer_cities(apps, schema_editor):
    """One city box becomes a list, and a campaign that already ran gets its start date.

    `starts_at` is the line between "reserved" and "paid for", so the rows this
    migration touches were all bought under the old rule where the coins went at
    the order. Anything that was running, paused or finished had really been
    charged, so it is stamped from its own creation date and keeps its refunds.
    """
    Promotion = apps.get_model('promotions', 'Promotion')
    for promo in Promotion.objects.all():
        asked = (promo.city or '').strip()
        Promotion.objects.filter(pk=promo.pk).update(
            cities=[asked] if asked else [],
            starts_at=promo.created_at if promo.status in ('active', 'paused', 'ended') else None,
        )


def put_city_back(apps, schema_editor):
    Promotion = apps.get_model('promotions', 'Promotion')
    for promo in Promotion.objects.all():
        first = (promo.cities or [''])[0]
        Promotion.objects.filter(pk=promo.pk).update(city=str(first)[:80])


class Migration(migrations.Migration):

    dependencies = [
        ('promotions', '0004_promo_target'),
    ]

    operations = [
        migrations.AddField(
            model_name='promotion',
            name='cities',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='promotion',
            name='starts_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(answer_cities, put_city_back),
        migrations.AlterField(
            model_name='promotion',
            name='status',
            field=models.CharField(
                choices=[
                    ('draft', 'Draft'), ('pending', 'Waiting for approval'), ('active', 'Active'),
                    ('paused', 'Paused'), ('ended', 'Ended'), ('rejected', 'Refused'),
                ],
                default='draft', max_length=10,
            ),
        ),
        migrations.RemoveField(model_name='promotion', name='city'),
    ]
