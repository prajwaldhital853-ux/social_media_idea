from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('promotions', '0005_promotion_pending_and_cities'),
    ]

    operations = [
        migrations.AddField(
            model_name='promotion',
            name='profile_visits',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.CreateModel(
            name='PromoEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(
                    choices=[('click', 'Opened the promoted post'), ('profile', 'Visited the payer')],
                    default='click', max_length=10)),
                ('day', models.DateField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('promotion', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                                related_name='events', to='promotions.promotion')),
                ('viewer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                             related_name='promo_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [models.Index(fields=['promotion', '-created_at'], name='promo_event_by_campaign')],
                'constraints': [models.UniqueConstraint(fields=['promotion', 'viewer', 'day', 'kind'],
                                                        name='promo_event_once_per_day')],
            },
        ),
    ]
