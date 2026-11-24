"""The two questions the bell asks on every page load.

One row per person, actor and kind is what a repeat notification is matched
against, and the badge counts the unread rows of one recipient — both were
reading the recipient's whole history.
"""

from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0002_notification_notice'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['recipient', 'actor', 'kind'], name='notif_dedupe'),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(
                fields=['recipient'], condition=Q(read_at__isnull=True), name='notif_unread',
            ),
        ),
    ]
