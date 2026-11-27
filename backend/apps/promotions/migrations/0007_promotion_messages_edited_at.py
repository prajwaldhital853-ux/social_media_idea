from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('promotions', '0006_promoevent_and_profile_visits'),
    ]

    operations = [
        migrations.AddField(
            model_name='promotion',
            name='messages',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='promotion',
            name='edited_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='promoevent',
            name='kind',
            field=models.CharField(
                choices=[
                    ('click', 'Opened the promoted post'),
                    ('profile', 'Visited the payer'),
                    ('message', 'Messaged the payer'),
                ],
                default='click',
                max_length=10,
            ),
        ),
    ]
