from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0007_alter_emailotp_purpose'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='emailotp',
            name='purpose',
            field=models.CharField(choices=[
                ('login', 'New device login'), ('unlock', 'Account unlock'),
                ('verify', 'Email verification'), ('delete', 'Account deletion'),
                ('reset', 'Password reset'), ('admin_reset', 'Staff password reset'),
            ], max_length=12),
        ),
        migrations.CreateModel(
            name='PasswordHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('password_hash', models.CharField(max_length=255)),
                ('set_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='password_hashes', to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-set_at']},
        ),
        migrations.AddIndex(
            model_name='passwordhistory',
            index=models.Index(fields=['user', '-set_at'], name='password_hist_user_recent'),
        ),
    ]
