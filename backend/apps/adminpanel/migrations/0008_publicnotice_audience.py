from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('adminpanel', '0007_staff_must_change_password'),
    ]

    operations = [
        migrations.AddField(
            model_name='publicnotice',
            name='audience',
            field=models.CharField(
                choices=[('public', 'Everyone reading the content'), ('private', 'Only the account it is about')],
                default='public', max_length=8,
            ),
        ),
    ]
