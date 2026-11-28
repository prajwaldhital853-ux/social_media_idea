from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0009_coinlot_coinrequest_refund'),
    ]

    operations = [
        migrations.AddField(
            model_name='coinrequest',
            name='refund_refused_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='coinrequest',
            name='refund_refuse_reason',
            field=models.CharField(blank=True, max_length=240),
        ),
    ]
