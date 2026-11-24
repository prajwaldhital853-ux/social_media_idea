from django.db import migrations


def remove_automatic_ip_bans(apps, schema_editor):
    """Clear old password/suspension network bans without touching manual bans."""
    AuthBan = apps.get_model('accounts', 'AuthBan')
    AuthBan.objects.filter(scope='ip', reason__in=['lock', 'admin']).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0008_passwordhistory_alter_emailotp_purpose'),
    ]

    operations = [
        migrations.RunPython(remove_automatic_ip_bans, migrations.RunPython.noop),
    ]
