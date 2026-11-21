from apps.profiles.models import Profile
from apps.profiles.views import ProfileSerializer

p = Profile.objects.get(user__username='sita')
q = lambda **kw: ProfileSerializer(instance=p, partial=True, **kw)
show = lambda s: (s.is_valid(), dict(s.errors))

print('bad  links   ->', show(q(data={'links': [{'label': 'evil', 'url': 'javascript:alert(1)'}]})))
print('good profile ->', show(q(data={
    'phone': '+977 98-1234567', 'website': 'https://example.com/a',
    'links': [{'label': 'Portfolio', 'url': 'https://prajwal.dev'}, {'label': 'X', 'url': 'http://x.com/pr'}]})))
print('short phone  ->', q(data={'phone': 'abc'}).is_valid())
print('ftp website  ->', q(data={'website': 'ftp://x.com'}).is_valid())
print('9 links      ->', q(data={'links': [{'label': str(i), 'url': 'https://x.io'} for i in range(9)]}).is_valid())
