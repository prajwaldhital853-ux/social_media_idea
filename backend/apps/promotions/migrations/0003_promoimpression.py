from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('promotions', '0002_promotion_clicks_promotion_ends_at_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='PromoImpression',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('day', models.DateField()),
                ('served_at', models.DateTimeField(auto_now_add=True)),
                ('promotion', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                               related_name='impression_rows', to='promotions.promotion')),
                ('viewer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                             related_name='promo_impressions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-served_at'],
                'indexes': [models.Index(fields=['viewer', '-day'], name='promo_seen_by_person'),
                            models.Index(fields=['promotion', '-day'], name='promo_delivered_on')],
                'constraints': [models.UniqueConstraint(fields=['promotion', 'viewer', 'day'],
                                                        name='promo_once_per_person_per_day')],
            },
        ),
    ]
