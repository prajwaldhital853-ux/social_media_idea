"""Indexes for the lookups every door performs, so none of them scans the table.

`email__iexact` is the one that matters most: Postgres answers it as
`UPPER(email::text) = UPPER(...)`, and a plain index on the column cannot serve
that expression. These match what the queries actually ask for.
"""

from django.db import migrations, models
from django.db.models.functions import Upper


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0009_remove_automatic_ip_bans'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='user',
            index=models.Index(Upper('email'), name='user_email_upper'),
        ),
        migrations.AddIndex(
            model_name='user',
            index=models.Index(Upper('username'), name='user_username_upper'),
        ),
        migrations.AddIndex(
            model_name='refreshsession',
            index=models.Index(fields=['expires_at'], name='refresh_expires'),
        ),
        migrations.AddIndex(
            model_name='emailotp',
            index=models.Index(fields=['expires_at'], name='otp_expires'),
        ),
        migrations.AddIndex(
            model_name='authban',
            index=models.Index(fields=['identity'], name='ban_identity'),
        ),
    ]
