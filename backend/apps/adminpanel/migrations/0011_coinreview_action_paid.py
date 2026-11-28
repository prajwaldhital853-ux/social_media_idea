from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('adminpanel', '0010_alert_rung_at'),
    ]

    operations = [
        migrations.AlterField(
            model_name='coinreview',
            name='action',
            field=models.CharField(
                choices=[('approve', 'Approved'), ('reject', 'Rejected'),
                         ('proof', 'Asked for more proof'), ('paid', 'Refund approved')],
                max_length=8,
            ),
        ),
    ]
