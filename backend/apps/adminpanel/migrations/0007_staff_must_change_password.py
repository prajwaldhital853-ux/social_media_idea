from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('adminpanel', '0006_adminpulse_alter_policyterm_kind'),
    ]

    operations = [
        migrations.AddField(
            model_name='staffaccount',
            name='must_change_password',
            field=models.BooleanField(default=False),
        ),
    ]
