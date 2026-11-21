"""One-off: writes the seeded About contacts onto the existing demo profiles.

Matches seed_demo.people() ordering so a fresh seed and this backfill agree.
"""
from apps.accounts.demo_content import CORE_PEOPLE, PEOPLE, contacts_for
from apps.profiles.models import Profile

roster = [row[0] for row in CORE_PEOPLE] + [row[0] for row in PEOPLE]
changed = 0
for index, username in enumerate(roster):
    profile = Profile.objects.filter(user__username=username).first()
    if not profile:
        continue
    patch = contacts_for(username, index)
    for field, value in patch.items():
        setattr(profile, field, value)
    profile.save(update_fields=list(patch))
    changed += 1

print(f'backfilled {changed} profiles')
sample = Profile.objects.filter(user__username='sita').first()
print('sita ->', sample.phone, sample.website, sample.links)
sample = Profile.objects.filter(user__username='maya').first()
print('maya ->', repr(sample.phone), sample.website, sample.links)
