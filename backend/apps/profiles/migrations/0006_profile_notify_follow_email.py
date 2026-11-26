from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('profiles', '0005_profile_notify_email'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='notify_follow_email',
            field=models.BooleanField(default=True),
        ),
    ]
