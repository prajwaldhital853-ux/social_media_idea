from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from apps.common.testutils import auth_client, make_user, run_threads
from apps.follows.models import Follow
from apps.messages.models import Conversation, Message


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