from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0004_coins_status_newest_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='coinrequest',
            name='resubmitted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
