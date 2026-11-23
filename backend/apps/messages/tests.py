from asgiref.sync import async_to_sync, sync_to_async
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import AsyncClient, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from apps.accounts.auth import issue_access
from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Follow
from apps.messages.models import Conversation, Message
from apps.messages.presence import is_watching, mark_watching, stop_watching

from exposing.asgi import application


class MessageTests(TestCase):
    def setUp(self):
        cache.clear()
        self.a = make_user('msga')
        self.b = make_user('msgb')
        self.ca = auth_client(self.a)
        self.cb = auth_client(self.b)

    def test_send_reuses_pair_conversation_and_notifies(self):
        resp = self.ca.post('/api/messages/msgb/', {'text': 'first'}, format='json')
        self.assertEqual(resp.status_code, 201)
        resp = self.cb.post('/api/messages/msga/', {'text': 'second'}, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Conversation.objects.count(), 1)
        self.assertEqual(Message.objects.count(), 2)
        self.assertTrue(self.b.notifications.filter(kind='message').exists())

    def test_a_thread_leaves_one_bell_row_not_one_per_message(self):
        for i in range(8):
            self.ca.post('/api/messages/msgb/', {'text': f'p{i}'}, format='json')
        rows = self.b.notifications.filter(kind='message')
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows[0].text, 'msga sent you a message.')
        rows.update(read_at=timezone.now())
        self.ca.post('/api/messages/msgb/', {'text': 'again'}, format='json')
        row = self.b.notifications.filter(kind='message').get()
        self.assertIsNone(row.read_at)
        self.assertEqual(self.cb.get('/api/notifications/unread/').data['unread'], 1)

    def test_inbox_unread_and_mark_read(self):
        self.ca.post('/api/messages/msgb/', {'text': 'hello'}, format='json')
        inbox = self.cb.get('/api/messages/inbox/')
        row = inbox.data['results'][0]
        self.assertEqual(row['user']['username'], 'msga')
        self.assertEqual(row['unread'], 1)
        self.assertEqual(row['last_message']['text'], 'hello')
        resp = self.cb.post('/api/messages/msga/read/')
        self.assertEqual(resp.status_code, 200)
        inbox = self.cb.get('/api/messages/inbox/')
        self.assertEqual(inbox.data['results'][0]['unread'], 0)

    def test_thread_ascending_and_pagination(self):
        for i in range(12):
            self.ca.post('/api/messages/msgb/', {'text': f'm{i}'}, format='json')
        resp = self.cb.get('/api/messages/msga/')
        self.assertEqual(len(resp.data['results']), 10)
        self.assertEqual(resp.data['results'][-1]['text'], 'm11')
        self.assertTrue(resp.data['has_more'])
        older = self.cb.get('/api/messages/msga/?cursor=' + resp.data['next_cursor'])
        self.assertEqual([m['text'] for m in older.data['results']], ['m0', 'm1'])

    def test_mutuals_appear_in_inbox_until_talked(self):
        Follow.objects.create(follower=self.a, followee=self.b, status='accepted')
        Follow.objects.create(follower=self.b, followee=self.a, status='accepted')
        inbox = self.cb.get('/api/messages/inbox/')
        self.assertEqual(inbox.data['results'], [])
        self.assertEqual([m['user']['username'] for m in inbox.data['mutuals']], ['msga'])
        self.ca.post('/api/messages/msgb/', {'text': 'hi'}, format='json')
        inbox = self.cb.get('/api/messages/inbox/')
        self.assertEqual(len(inbox.data['results']), 1)
        self.assertEqual(inbox.data['mutuals'], [])

    def test_empty_and_self_message_rejected(self):
        resp = self.ca.post('/api/messages/msgb/', {'text': '   '}, format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.ca.post('/api/messages/msga/', {'text': 'hi'}, format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.ca.post('/api/messages/msgb/', {'text': 'x' * 2001}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_receipt_walks_sent_delivered_read(self):
        resp = self.ca.post('/api/messages/msgb/', {'text': 'ticks'}, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'sent')
        # The sender's own view of the thread still shows the message as sent.
        seen = self.ca.get('/api/messages/msgb/').data['results'][-1]
        self.assertEqual(seen['status'], 'sent')
        # The recipient listing the inbox proves delivery; opening the thread proves a read.
        self.cb.get('/api/messages/inbox/')
        delivered = self.ca.get('/api/messages/msgb/').data['results'][-1]
        self.assertEqual(delivered['status'], 'delivered')
        self.cb.post('/api/messages/msga/read/')
        read = self.ca.get('/api/messages/msgb/').data['results'][-1]
        self.assertEqual(read['status'], 'read')
        # A reader who jumps straight to the thread without an inbox first is
        # still delivered-and-read in one step, never stuck behind.
        self.ca.post('/api/messages/msgb/', {'text': 'again'}, format='json')
        self.cb.get('/api/messages/msga/')
        row = self.ca.get('/api/messages/msgb/').data['results'][-1]
        self.assertEqual(row['status'], 'delivered')
        self.cb.post('/api/messages/msga/read/')
        row = self.ca.get('/api/messages/msgb/').data['results'][-1]
        self.assertEqual(row['status'], 'read')


class MessageConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.a = make_user('concmsga')
        self.b = make_user('concmsgb')

    def test_simultaneous_first_messages_one_conversation(self):
        clients = [auth_client(self.a) for _ in range(8)]

        def send(item):
            client, i = item
            return client.post('/api/messages/concmsgb/', {'text': f'race {i}'}, format='json').status_code

        codes = run_threads(send, list(zip(clients, range(8))))
        self.assertEqual(codes, [201] * 8)
        self.assertEqual(Conversation.objects.count(), 1)
        self.assertEqual(Message.objects.count(), 8)

    def test_simultaneous_messages_both_directions(self):
        ca = [auth_client(self.a) for _ in range(6)]
        cb = [auth_client(self.b) for _ in range(6)]

        def send(item):
            client, target, i = item
            return client.post(f'/api/messages/{target}/', {'text': f'm{i}'}, format='json').status_code

        jobs = [(c, 'concmsgb', i) for i, c in enumerate(ca)] + [(c, 'concmsga', i) for i, c in enumerate(cb)]
        codes = run_threads(send, jobs, workers=12)
        self.assertEqual(codes, [201] * 12)
        self.assertEqual(Conversation.objects.count(), 1)
        self.assertEqual(Message.objects.count(), 12)


class ChatSocketTests(TransactionTestCase):
    """The thread socket: cookie auth, caps, and the relay the REST views push to."""

    # The origin validator was built with settings.WS_ORIGINS at import time, so
    # tests speak the default browser origin instead of overriding the setting.
    ORIGIN = (b'origin', b'http://localhost:3000')

    def setUp(self):
        cache.clear()
        self.a = make_user('wsa')
        self.b = make_user('wsb')
        self.ca = auth_client(self.a)
        self.cb = auth_client(self.b)

    def _comm(self, user, username):
        return WebsocketCommunicator(application, f'/ws/chat/{username}/', headers=[
            self.ORIGIN,
            (b'cookie', f'exposing_access={issue_access(user)}'.encode()),
        ])

    def test_unauthenticated_socket_is_rejected(self):
        async def run():
            comm = WebsocketCommunicator(application, '/ws/chat/wsb/', headers=[self.ORIGIN])
            try:
                connected, code = await comm.connect()
                self.assertFalse(connected)
                self.assertEqual(code, 4401)
            finally:
                await comm.disconnect()
        async_to_sync(run)()

    def test_self_and_missing_thread_are_rejected(self):
        async def run():
            comm = self._comm(self.a, 'wsa')
            try:
                connected, code = await comm.connect()
                self.assertFalse(connected)
                self.assertEqual(code, 4404)
            finally:
                await comm.disconnect()
            comm = self._comm(self.a, 'nobody-here')
            try:
                connected, code = await comm.connect()
                self.assertFalse(connected)
                self.assertEqual(code, 4404)
            finally:
                await comm.disconnect()
        async_to_sync(run)()

    def test_socket_cap_per_user(self):
        @override_settings(WS_SOCKETS_PER_USER=1)
        async def run():
            first = self._comm(self.a, 'wsb')
            try:
                connected, _ = await first.connect()
                self.assertTrue(connected)
                second = self._comm(self.a, 'wsb')
                try:
                    connected, code = await second.connect()
                    self.assertFalse(connected)
                    self.assertEqual(code, 4429)
                finally:
                    await second.disconnect()
            finally:
                await first.disconnect()
        async_to_sync(run)()

    def test_ping_typing_and_message_relay_with_read_receipt(self):
        async def run():
            comm_a = self._comm(self.a, 'wsb')
            comm_b = self._comm(self.b, 'wsa')
            try:
                self.assertTrue((await comm_a.connect())[0])
                self.assertTrue((await comm_b.connect())[0])
                ready_a = await comm_a.receive_json_from(timeout=5)
                ready_b = await comm_b.receive_json_from(timeout=5)
                self.assertEqual(ready_a, {'kind': 'ready', 'thread': 'wsb'})
                self.assertEqual(ready_b, {'kind': 'ready', 'thread': 'wsa'})

                await comm_a.send_json_to({'type': 'ping'})
                self.assertEqual(await comm_a.receive_json_from(timeout=5), {'kind': 'pong'})

                await comm_a.send_json_to({'type': 'typing'})
                typing = await comm_b.receive_json_from(timeout=5)
                self.assertEqual(typing, {'kind': 'typing', 'by': 'wsa'})

                # The REST send arrives on both wires; the client itself is sync
                # code and must leave the event loop for its ORM queries.
                resp = await sync_to_async(self.ca.post)('/api/messages/wsb/', {'text': 'over the wire'}, format='json')
                self.assertEqual(resp.status_code, 201)
                mine = await comm_a.receive_json_from(timeout=5)
                theirs = await comm_b.receive_json_from(timeout=5)
                self.assertEqual(mine['kind'], 'message')
                self.assertEqual(mine['message']['status'], 'sent')
                self.assertEqual(theirs['kind'], 'message')
                self.assertEqual(theirs['message']['text'], 'over the wire')

                await comm_b.send_json_to({'type': 'read'})
                read = await comm_a.receive_json_from(timeout=5)
                self.assertEqual(read['kind'], 'read')
                self.assertEqual(read['read'], 1)
            finally:
                await comm_a.disconnect()
                await comm_b.disconnect()
        async_to_sync(run)()

    def test_an_open_socket_is_a_reader_watching_the_thread(self):
        async def run():
            comm = self._comm(self.b, 'wsa')
            try:
                self.assertTrue((await comm.connect())[0])
                self.assertTrue(is_watching(self.b.pk, self.a.pk))
            finally:
                await comm.disconnect()
            # Gone means gone: the next message to an absent reader is worth a bell.
            self.assertFalse(is_watching(self.b.pk, self.a.pk))
        async_to_sync(run)()


class ThreadStreamTests(TestCase):
    """The thread's own stream: the rows it carries, the receipts, and the
    watching it proves while a browser holds the request open."""

    def setUp(self):
        cache.clear()
        self.a = make_user('ssea')
        self.b = make_user('sseb')
        self.ca = auth_client(self.a)
        self.cb = auth_client(self.b)
        self.token = issue_access(self.a)

    def _client(self):
        client = AsyncClient()
        client.cookies['exposing_access'] = self.token
        return client

    async def _drain(self, resp):
        return await self._drain_from(resp.streaming_content)

    async def _drain_from(self, frames):
        chunks = []
        async for chunk in frames:
            chunks.append(chunk.decode())
        return ''.join(chunks)

    async def test_the_stream_wants_a_reader_and_a_thread(self):
        self.assertEqual((await AsyncClient().get('/api/messages/sseb/stream/')).status_code, 401)
        client = self._client()
        self.assertEqual((await client.get('/api/messages/nobody-here/stream/')).status_code, 404)
        self.assertEqual((await client.get('/api/messages/ssea/stream/')).status_code, 404)

    def _seed_thread(self):
        """A pair of rows, a receipt and a keystroke — from the sync client,
        which an async test has to hand to a thread like any other ORM work."""
        self.ca.post('/api/messages/sseb/', {'text': 'the one I sent'}, format='json')
        self.cb.post('/api/messages/ssea/', {'text': 'the answer'}, format='json')
        self.cb.post('/api/messages/ssea/read/', {}, format='json')
        self.cb.post('/api/messages/ssea/typing/', {}, format='json')

    @override_settings(CHAT_SSE_INTERVAL=0.05, SSE_MAX_LIFE=0.2)
    async def test_the_stream_carries_rows_receipts_and_a_keystroke(self):
        await sync_to_async(self._seed_thread)()

        body = await self._drain(await self._client().get('/api/messages/sseb/stream/'))
        # A stream opened a beat after the page fetch starts a few seconds back,
        # so a message written inside that gap is carried rather than lost; the
        # client merges by id and shows it once.
        self.assertIn('event: chat', body)
        self.assertIn('the answer', body)
        self.assertIn('the one I sent', body)
        self.assertIn('event: receipt', body)
        self.assertIn('"state":"read"', body)
        self.assertIn('event: typing', body)
        self.assertIn('"by":"sseb"', body)

    @override_settings(CHAT_SSE_INTERVAL=0.05, SSE_MAX_LIFE=0.5)
    async def test_an_open_stream_is_a_reader_watching(self):
        response = await self._client().get('/api/messages/sseb/stream/')
        frames = response.streaming_content
        await frames.__anext__()   # the retry line, before the first look
        await frames.__anext__()   # one tick round: it proves the reader is here
        self.assertTrue(is_watching(self.a.pk, self.b.pk))
        # Running the stream out to the server's own close is what a browser's
        # reconnect rides, and the flag has to lapse with it.
        await self._drain_from(frames)
        self.assertFalse(is_watching(self.a.pk, self.b.pk))

    def test_a_message_to_a_watching_reader_rings_no_bell(self):
        self.ca.post('/api/messages/sseb/', {'text': 'are you there'}, format='json')
        rows = self.b.notifications.filter(kind='message')
        self.assertEqual(rows.count(), 1)
        rows.update(read_at=timezone.now())

        mark_watching(self.b.pk, self.a.pk)
        self.ca.post('/api/messages/sseb/', {'text': 'answer, not an alarm'}, format='json')
        self.assertIsNotNone(rows.get().read_at)

        stop_watching(self.b.pk, self.a.pk)
        self.ca.post('/api/messages/sseb/', {'text': 'while you were out'}, format='json')
        self.assertIsNone(rows.get().read_at)

    def test_reading_the_thread_reads_its_bells(self):
        self.ca.post('/api/messages/sseb/', {'text': 'ping'}, format='json')
        self.cb.post('/api/messages/ssea/', {'text': 'pong'}, format='json')
        resp = self.cb.post('/api/messages/ssea/read/')
        self.assertEqual(resp.data['read'], 1)
        self.assertEqual(resp.data['notifications'], 1)
        self.assertIsNotNone(self.b.notifications.filter(kind='message').get().read_at)
        # Reading a thread says nothing about the bells another person earned.
        self.assertIsNone(self.a.notifications.filter(kind='message').get().read_at)