from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('adminpanel', '0011_coinreview_action_paid'),
    ]

    operations = [
        migrations.AlterField(
            model_name='coinreview',
            name='action',
            field=models.CharField(
                choices=[('approve', 'Approved'), ('reject', 'Rejected'),
                         ('proof', 'Asked for more proof'), ('paid', 'Refund approved'),
                         ('refused', 'Refund refused')],
                max_length=8,
            ),
        ),
    ]
