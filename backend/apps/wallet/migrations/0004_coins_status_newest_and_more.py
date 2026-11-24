"""Indexes for the coin queue.

The console opens on the pending pile and a member reads their own requests;
neither is served by the natural newest-first ordering alone.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0003_ledger_append_only_trigger'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='coinrequest',
            index=models.Index(fields=['status', '-created_at'], name='coins_status_newest'),
        ),
        migrations.AddIndex(
            model_name='coinrequest',
            index=models.Index(fields=['user', '-created_at'], name='coins_user_newest'),
        ),
    ]
