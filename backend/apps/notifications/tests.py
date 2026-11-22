from datetime import timedelta

from django.core.cache import cache
from django.test import AsyncClient, TestCase, override_settings
from django.utils import timezone
from urllib.parse import quote

from asgiref.sync import sync_to_async
from apps.common import stream as streams
from apps.accounts.auth import issue_access
from apps.common.testutils import auth_client, make_user
from apps.messages.models import Conversation, Message
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

    def test_badge_endpoint_counts_both_inboxes(self):
        notify(self.a, self.b, 'like', 'for a')
        pair = Conversation.objects.create()
        pair.participants.set([self.a, self.b])
        Message.objects.create(conversation=pair, sender=self.b, text='unread for a')
        Message.objects.create(conversation=pair, sender=self.a, text='sent by a, never a badge')
        row = self.ca.get('/api/notifications/unread/').data
        self.assertEqual(row['unread'], 1)
        self.assertEqual(row['messages'], 1)

    def test_unread_filter_and_isolation(self):
        notify(self.a, self.b, 'like', 'for a')
        notify(self.b, self.a, 'like', 'for b')
        resp = self.ca.get('/api/notifications/?unread=1')
        self.assertEqual(len(resp.data['results']), 1)
        self.assertEqual(resp.data['results'][0]['text'], 'for a')
        self.assertEqual(self.ca.get('/api/notifications/').data['results'][0]['actor_username'], 'notifb')


class NotificationStreamTests(TestCase):
    """The SSE line: cookie auth, per-user cap, keepalive, cursor recovery."""

    def setUp(self):
        cache.clear()
        self.a = make_user('streama')
        self.b = make_user('streamb')
        self.token = issue_access(self.a)

    def _client(self):
        client = AsyncClient()
        client.cookies['exposing_access'] = self.token
        return client

    async def _drain(self, resp):
        """Consume the stream until the server closes it (max life), so the
        view's slot-release finally runs — the same close a browser's reconnect
        rides. The test client never consumes a body on its own."""
        chunks = []
        async for chunk in resp.streaming_content:
            chunks.append(chunk.decode())
        return ''.join(chunks)

    async def test_stream_requires_auth(self):
        resp = await AsyncClient().get('/api/notifications/stream/')
        self.assertEqual(resp.status_code, 401)

    @override_settings(SSE_INTERVAL=0.05, SSE_MAX_LIFE=0.2)
    async def test_stream_headers_and_keepalive(self):
        resp = await self._client().get('/api/notifications/stream/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers['Content-Type'], 'text/event-stream')
        body = await self._drain(resp)
        self.assertTrue(body.startswith('retry: 4000\n\n'))
        self.assertIn(': keepalive\n\n', body)

    @override_settings(SSE_INTERVAL=0.05, SSE_MAX_LIFE=0.2, SSE_STREAMS_PER_USER=1)
    async def test_stream_cap_per_user(self):
        client = self._client()
        first = await client.get('/api/notifications/stream/')
        self.assertEqual(first.status_code, 200)
        # Hold the slot: the pump starts the generator without finishing it.
        async for _ in first.streaming_content:
            break
        second = await client.get('/api/notifications/stream/')
        self.assertEqual(second.status_code, 429)
        # Draining runs the stream out to its max-life close and frees the slot.
        await self._drain(first)
        self.assertEqual(streams.held(self.a.pk), 0)
        third = await client.get('/api/notifications/stream/')
        self.assertEqual(third.status_code, 200)
        await self._drain(third)
        self.assertEqual(streams.held(self.a.pk), 0)

    @override_settings(SSE_INTERVAL=0.05, SSE_MAX_LIFE=0.2)
    async def test_last_event_id_replays_missed_rows(self):
        old, fresh = await sync_to_async(self._seed_rows)()

        cursor = quote(f'{old.created_at.isoformat()}|{old.pk}')
        resp = await self._client().get(f'/api/notifications/stream/?last_event_id={cursor}')
        body = await self._drain(resp)
        self.assertIn('event: notification', body)
        self.assertIn('the fresh row', body)
        self.assertNotIn('the old row', body)
        self.assertIn(f"id: {fresh.created_at.isoformat()}|{fresh.pk}", body)

    def _seed_rows(self):
        """Sync ORM setup: the async test body cannot touch the ORM directly."""
        old = notify(self.a, self.b, 'like', 'the old row')
        Notification.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(hours=1))
        old.refresh_from_db()
        fresh = notify(self.a, self.b, 'follow', 'the fresh row')
        return old, fresh