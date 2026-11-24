"""Indexes for the two saved lists.

The unique pair that stops a second save is keyed by the saved object, so it
cannot serve the list a member opens, which reads by user and newest first.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('saved', '0002_savedlisting'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='savedpost',
            index=models.Index(fields=['user', '-created_at'], name='saved_post_user_newest'),
        ),
        migrations.AddIndex(
            model_name='savedlisting',
            index=models.Index(fields=['user', '-created_at'], name='saved_listing_user_newest'),
        ),
    ]
