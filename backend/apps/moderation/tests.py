from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from apps.common.testutils import auth_client, make_user, staff_client
from apps.moderation.models import AuditLog, Report
from apps.posts.models import Post


class ModerationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.reporter = make_user('reporter')
        self.author = make_user('modauthor')
        self.staff = staff_client()
        self.cr = auth_client(self.reporter)
        self.post = Post.objects.create(author=self.author, text='reported post', audience='public')

    def report(self):
        return self.cr.post('/api/moderation/reports/', {'target_type': 'post', 'target_id': str(self.post.pk), 'reason': 'spam', 'details': 'repeated'}, format='json')

    def test_any_user_can_report_but_only_staff_lists(self):
        resp = self.report()
        self.assertEqual(resp.status_code, 201)
        resp = self.cr.get('/api/moderation/reports/')
        self.assertEqual(resp.status_code, 403)
        resp = self.staff.get('/api/moderation/reports/')
        self.assertEqual(len(resp.data['results']), 1)

    def test_dismiss_and_resolve_close_report(self):
        rid = self.report().data['id']
        resp = self.staff.post(f'/api/moderation/reports/{rid}/dismiss/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'dismissed')
        resp = self.staff.post(f'/api/moderation/reports/{rid}/resolve/')
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(AuditLog.objects.filter(action='dismiss_report').exists())

    def test_remove_takes_down_content_and_warns_owner(self):
        rid = self.report().data['id']
        resp = self.staff.post(f'/api/moderation/reports/{rid}/remove/')
        self.assertEqual(resp.status_code, 200)
        self.post.refresh_from_db()
        self.assertEqual(self.post.status, 'removed')
        self.assertTrue(self.author.notifications.filter(kind='warning').exists())
        feed = auth_client(self.reporter).get('/api/feed/')
        self.assertTrue(all(p['id'] != self.post.pk for p in feed.data['results']))

    def test_non_staff_cannot_act(self):
        rid = self.report().data['id']
        resp = self.cr.post(f'/api/moderation/reports/{rid}/remove/')
        self.assertIn(resp.status_code, (403, 404))
        resp = self.cr.post('/api/moderation/users/modauthor/suspend/', {'days': 1}, format='json')
        self.assertIn(resp.status_code, (403, 404))

    def test_suspend_and_reinstate(self):
        resp = self.staff.post('/api/moderation/users/modauthor/suspend/', {'days': 3, 'reason': 'abuse'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.author.refresh_from_db()
        self.assertTrue(self.author.is_suspended)
        self.assertEqual(self.author.suspend_reason, 'abuse')
        self.assertTrue(AuditLog.objects.filter(action='suspend_user').exists())
        resp = self.staff.post('/api/moderation/users/modauthor/reinstate/')
        self.assertEqual(resp.status_code, 200)
        self.author.refresh_from_db()
        self.assertFalse(self.author.is_suspended)

    def test_suspension_expires(self):
        self.author.suspended_until = timezone.now() - timedelta(hours=1)
        self.author.save(update_fields=['suspended_until'])
        self.assertFalse(self.author.is_suspended)

    def test_audit_log_staff_only_and_paginated(self):
        self.staff.post('/api/moderation/users/modauthor/suspend/', {'days': 1}, format='json')
        resp = self.cr.get('/api/moderation/audit/')
        self.assertIn(resp.status_code, (403, 404))
        resp = self.staff.get('/api/moderation/audit/')
        self.assertEqual(len(resp.data['results']), 1)
        self.assertEqual(resp.data['results'][0]['action'], 'suspend_user')