from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('adminpanel', '0008_publicnotice_audience'),
    ]

    operations = [
        migrations.CreateModel(
            name='StaffNotice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(max_length=32)),
                ('text', models.CharField(max_length=200)),
                ('href', models.CharField(blank=True, max_length=160)),
                ('route', models.CharField(blank=True, max_length=80)),
                ('permission', models.CharField(blank=True, max_length=40)),
                ('read_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('recipient', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='staff_notices',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='staffnotice',
            index=models.Index(fields=['recipient', '-created_at'], name='bell_recipient_newest'),
        ),
        migrations.AddIndex(
            model_name='staffnotice',
            index=models.Index(
                condition=models.Q(('read_at__isnull', True)),
                fields=['recipient'],
                name='bell_unread',
            ),
        ),
    ]
