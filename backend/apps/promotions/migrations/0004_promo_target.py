"""The target index the review and people desks read.

They ask "is this post or listing under a campaign" row by row, by target rather
than by the running status the delivery engine filters on.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('promotions', '0003_promoimpression'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='promotion',
            index=models.Index(fields=['target_type', 'target_id'], name='promo_target'),
        ),
    ]
