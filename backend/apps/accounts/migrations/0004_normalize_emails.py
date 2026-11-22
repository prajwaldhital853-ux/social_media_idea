# Stores every address the same way, and marks which accounts the demo seeder owns.
#
# The normalization used to happen only in the signup view, so an address that
# reached the row any other way — Google's claim, an admin edit, a script — was
# saved as written and then missed by the lowercased lookup at sign-in. That is
# what "my account is gone" looks like from the outside.

from django.db import migrations, models


def normalize_emails(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    for user in User.objects.exclude(email=''):
        email = user.email.strip().lower()
        if email != user.email:
            user.email = email
            user.save(update_fields=['email'])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_user_seeded'),
    ]

    operations = [
        migrations.RunPython(normalize_emails, migrations.RunPython.noop),
    ]
