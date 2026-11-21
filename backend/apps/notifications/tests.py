from django.core.cache import cache
from django.test import TestCase

from apps.common.testutils import auth_client, make_user
from apps.notifications.models import Notification
from apps.notifications.services import notify


class NotificationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.a = make_user('notifa')
        self.b = make_user('notifb')
        self.ca = auth_client(self.a)

    def test_notify_skips_self(self):
        self.assertIsNone(notify(self.a, self.a, 'like', 'self'))
        self.assertEqual(Notification.objects.count(), 0)
        notify(self.a, self.b, 'like', 'from b')
        self.assertEqual(Notification.objects.count(), 1)

    def test_list_unread_and_mark_read(self):
        for i in range(3):
            notify(self.a, self.b, 'like', f'n{i}')
        resp = self.ca.get('/api/notifications/unread/')
        self.assertEqual(resp.data['unread'], 3)
        resp = self.ca.get('/api/notifications/')
        self.assertEqual(len(resp.data['results']), 3)
        first = resp.data['results'][0]['id']
        resp = self.ca.post('/api/notifications/read/', {'ids': [first]}, format='json')
        self.assertEqual(resp.data['read'], 1)
        self.assertEqual(self.ca.get('/api/notifications/unread/').data['unread'], 2)
        resp = self.ca.post('/api/notifications/read/', {'all': True}, format='json')
        self.assertEqual(resp.data['read'], 2)
        self.assertEqual(self.ca.get('/api/notifications/unread/').data['unread'], 0)

    def test_unread_filter_and_isolation(self):
        notify(self.a, self.b, 'like', 'for a')
        notify(self.b, self.a, 'like', 'for b')
        resp = self.ca.get('/api/notifications/?unread=1')
        self.assertEqual(len(resp.data['results']), 1)
        self.assertEqual(resp.data['results'][0]['text'], 'for a')
        self.assertEqual(self.ca.get('/api/notifications/').data['results'][0]['actor_username'], 'notifb')