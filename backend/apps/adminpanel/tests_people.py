"""Contract 6.4: what a seat may do to an account, and what has to happen when it does.

These tests are written from the person's side of the screen, because that is
where a mistake costs something. A suspension is only real if the account that
received it cannot open the app on its next click and cannot renew its session;
an email is only real if it carries the reason and a way to appeal; a deletion is
only safe if the money was settled first and the audit row outlives the account;
and a flag that is cleared must not silently undo a decision somebody made.

The directory is checked the way a moderator reads it: how each account signed
up, what is piled on it, and what a seat that may look but may not sign sees.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core import mail
from django.utils import timezone

from apps.accounts.models import AuthBan, RefreshSession, User
from apps.common.testutils import auth_client, make_user
from apps.moderation.models import AuditLog, Report
from apps.notifications.models import Notification
from apps.posts.models import Post
from apps.wallet.models import CoinRequest

from . import people, settings_store
from .models import StaffAccount
from .tests_review import ReviewTestCase

PEOPLE_URL = '/api/admin/people/'
ME_URL = '/api/auth/me/'


class DirectoryTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.admin_seat = self.session('desk_admin')

    def test_the_directory_shows_how_each_account_signed_up(self):
        User.objects.filter(username='ordinary').update(provider='google')
        make_user('gmail_person', provider='google')

        page = self.admin_seat.get(PEOPLE_URL)
        self.assertEqual(page.status_code, 200, page.data)
        row = next(item for item in page.data['results'] if item['username'] == 'ordinary')
        self.assertEqual(row['provider'], 'google')
        self.assertEqual(row['provider_label'], 'Google')
        self.assertEqual(row['email'], 'ordinary@test.local')
        self.assertEqual(row['role'], 'user')
        self.assertEqual(row['coins'], '0.00')
        self.assertIsNone(row['suspension'])
        # A provider the code has never written still gets counted, so the chip
        # says zero rather than leaving the reader to guess whether it is broken.
        self.assertEqual(
            page.data['facets']['by_provider'],
            {'email': page.data['facets']['total'] - 2, 'google': 2, 'facebook': 0, 'apple': 0},
        )

    def test_search_reaches_the_handle_the_email_and_the_display_name(self):
        found = make_user('qa_searchable', email='findingme@example.org')
        found.profile.display_name = 'Bikets Newa'
        found.profile.save(update_fields=['display_name'])

        for query, label in (('qa_searchable', 'the handle'), ('findingme@example', 'the email'),
                             ('Bikets', 'the display name')):
            page = self.admin_seat.get(f'{PEOPLE_URL}?q={query.replace(" ", "%20")}')
            self.assertEqual([item['username'] for item in page.data['results']], ['qa_searchable'],
                             f'searching by {label} finds that one account')

    def test_the_state_chip_and_the_provider_chip_narrow_the_same_list(self):
        google = make_user('google_barred', provider='google')
        by_email = make_user('email_barred', provider='email')
        for user in (google, by_email):
            user.suspended_until = timezone.now() + timedelta(days=5)
            user.suspend_reason = 'repeated harassment reports'
            user.save(update_fields=['suspended_until', 'suspend_reason'])

        page = self.admin_seat.get(f'{PEOPLE_URL}?status=suspended&provider=google')
        names = [item['username'] for item in page.data['results']]
        self.assertEqual(names, ['google_barred'])
        self.assertTrue(page.data['results'][0]['suspension']['days_left'])

        everything = self.admin_seat.get(f'{PEOPLE_URL}?status=suspended')
        self.assertEqual(len(everything.data['results']), 2)

    def test_an_account_is_flagged_at_the_number_the_queue_uses_not_a_new_one(self):
        victim = make_user('pile_target')
        post = self.post_of(author=victim, text='a caption three people disliked')
        self.pile_on(post)  # three distinct reporters, the live threshold

        page = self.admin_seat.get(f'{PEOPLE_URL}?status=flagged')
        self.assertIn('pile_target', [item['username'] for item in page.data['results']])

        row = next(item for item in self.admin_seat.get(
            f'{PEOPLE_URL}?q=pile_target').data['results'] if item['username'] == 'pile_target')
        self.assertEqual(row['flags']['on_content'], 3)
        self.assertEqual(row['flags']['reporters'], 3)
        self.assertEqual(row['flags']['auto_hide_at'], settings.EXPOSING_REPORT_THRESHOLD)

        # One report from one person is not a pile, and must not read like one.
        quiet = make_user('quiet_person')
        self.reported(self.post_of(author=quiet), reporter=make_user())
        self.assertNotIn('quiet_person', [item['username'] for item in
                                          self.admin_seat.get(f'{PEOPLE_URL}?status=flagged').data['results']])

    def test_the_detail_card_carries_the_pile_the_warnings_and_the_record(self):
        victim = make_user('opened_account')
        post = self.post_of(author=victim, text='still up but reported')
        self.reported(post, reporter=make_user())
        self.reported(victim, kind='user', reason='impersonation', reporter=make_user())

        got = self.admin_seat.get(f'{PEOPLE_URL}opened_account/')
        self.assertEqual(got.status_code, 200, got.data)
        self.assertEqual(got.data['person']['username'], 'opened_account')
        self.assertEqual(len(got.data['reports']), 1)
        self.assertEqual(got.data['reports'][0]['reason'], 'impersonation')
        self.assertIn(f'post:{post.pk}', [item['target'] for item in got.data['content']])
        self.assertEqual(got.data['holdings']['posts'], 1)
        self.assertEqual(got.data['can']['actions'], True)

        self.assertEqual(self.admin_seat.get(f'{PEOPLE_URL}nobody_here/').status_code, 404)

    def test_a_bad_filter_is_answered_instead_of_being_ignored(self):
        wrong = self.admin_seat.get(f'{PEOPLE_URL}?status=on_fire')
        self.assertEqual(wrong.status_code, 400)
        self.assertIn('active, suspended, flagged', wrong.data['detail'])

        provider = self.admin_seat.get(f'{PEOPLE_URL}?provider=mysteries')
        self.assertEqual(provider.status_code, 400)
        self.assertIn('Email, Google, Facebook or Apple', provider.data['detail'])


class SuspendTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.admin_seat = self.session('desk_admin')

    def test_a_temporary_suspension_bars_the_account_at_its_next_request(self):
        victim = auth_client(self.member)
        self.assertEqual(victim.get(ME_URL).status_code, 200, 'they can open the app before')
        held = RefreshSession.objects.create(
            user=self.member, jti='held-token', expires_at=timezone.now() + timedelta(days=7),
        )

        out = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'days': 3, 'reason': 'impersonating a support agent'},
            format='json',
        )
        self.assertEqual(out.status_code, 200, out.data)
        self.assertEqual(out.data['permanent'], False)
        self.assertEqual(out.data['sessions_revoked'], 1)

        self.member.refresh_from_db()
        self.assertTrue(self.member.is_suspended)
        self.assertEqual(self.member.suspend_reason, 'impersonating a support agent')
        held.refresh_from_db()
        self.assertIsNotNone(held.revoked_at, 'their refresh token is dead')
        self.assertEqual(victim.get(ME_URL).status_code, 401, 'the session they are holding stops here')

        back = self.admin_seat.post(f'{PEOPLE_URL}ordinary/reinstate/', {}, format='json')
        self.assertEqual(back.status_code, 200, back.data)
        self.assertEqual(victim.get(ME_URL).status_code, 200, 'and comes back the moment it is lifted')

    def test_a_permanent_suspension_is_the_same_column_with_no_end(self):
        out = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'permanent': True, 'reason': 'banned on another platform'},
            format='json',
        )
        self.assertEqual(out.status_code, 200, out.data)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_suspended)
        self.assertEqual(out.data['suspension']['permanent'], True)
        self.assertIsNone(out.data['suspension']['days_left'])
        self.assertGreater(self.member.suspended_until, people.PERMANENT_UNTIL - timedelta(days=1))

        # The screen can only offer "suspend for good" if it can tell it apart
        # from a long temporary bar, and lifting either one is one write.
        long_out = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'days': 30, 'reason': 'a very long bar'}, format='json')
        self.assertFalse(long_out.data['suspension']['permanent'])
        lifted = self.admin_seat.post(f'{PEOPLE_URL}ordinary/reinstate/', {}, format='json')
        self.member.refresh_from_db()
        self.assertEqual(lifted.status_code, 200)
        self.assertIsNone(self.member.suspended_until)

    def test_the_suspension_email_carries_the_reason_and_a_way_to_appeal(self):
        settings_store.write(self.admin, {'contact_phone': '+977-9812345678'})
        out = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'days': 14, 'reason': 'selling counterfeits'},
            format='json',
        )
        self.assertEqual(out.status_code, 200, out.data)
        self.assertEqual(len(mail.outbox), 1, 'the suspension is emailed')
        letter = mail.outbox[0]
        self.assertEqual(letter.to, ['ordinary@test.local'])
        self.assertIn('suspended', letter.subject.lower())
        self.assertIn('selling counterfeits', letter.body)
        self.assertIn('support@exposing.app', letter.body)
        self.assertIn('+977-9812345678', letter.body)
        self.assertIn('next request', letter.body)
        self.assertIn('Questions? Contact Exposing support', letter.alternatives[0].content)
        self.assertIn('cid:exposing-logo', letter.alternatives[0].content,
                      'the mark rides inside the letter, since a mail client will not fetch it')
        self.assertTrue(letter.attachments, 'the brand mark is attached rather than linked')
        self.assertEqual(out.data['emailed']['to'], 'ordinary@test.local')

        bell = Notification.objects.filter(recipient=self.member, kind='warning').first()
        self.assertIsNotNone(bell)
        self.assertIn('selling counterfeits', bell.text)

        entry = AuditLog.objects.filter(action='suspend_user').first()
        self.assertEqual(entry.target, 'ordinary')
        self.assertEqual(entry.actor.username, 'desk_admin')
        self.assertIn('selling counterfeits', entry.detail)

    def test_suspension_does_not_ban_the_accounts_shared_public_ip(self):
        shared_ip = '192.0.2.77'
        User.objects.filter(pk=self.member.pk).update(last_ip=shared_ip, last_device='dev-ordinary')
        out = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'days': 3, 'reason': 'policy violation'}, format='json',
        )
        self.assertEqual(out.status_code, 200, out.data)
        self.assertFalse(AuthBan.objects.filter(scope='ip', value=shared_ip).exists())
        self.assertTrue(AuthBan.objects.filter(scope='email', value=self.member.email, reason='admin').exists())
        self.assertTrue(AuthBan.objects.filter(scope='device', value='dev-ordinary', reason='admin').exists())

    def test_an_end_date_the_seat_picked_is_the_end_that_bars_them(self):
        soon = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'until': '2030-01-05', 'reason': 'until then'}, format='json')
        self.assertEqual(soon.status_code, 200, soon.data)
        self.member.refresh_from_db()
        self.assertEqual(self.member.suspended_until.year, 2030)
        self.assertEqual(self.member.suspended_until.month, 1)
        self.assertEqual(self.member.suspended_until.day, 5)
        self.assertEqual(self.member.suspended_until.hour, 23,
                         '“until the fifth” means all of the fifth, not the minute it starts')

        past = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'until': '2001-01-01', 'reason': 'back then'}, format='json')
        self.assertEqual(past.status_code, 400)
        self.assertIn('future', past.data['detail'])

        nonsense = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'until': 'the second of never'}, format='json')
        self.assertEqual(nonsense.status_code, 400)

        nothing = self.admin_seat.post(
            f'{PEOPLE_URL}ordinary/suspend/', {'reason': 'no end given'}, format='json')
        self.assertEqual(nothing.status_code, 400)
        self.assertIn('number of days', nothing.data['detail'])

    def test_a_suspension_without_a_reason_is_refused_before_it_bars_anyone(self):
        out = self.admin_seat.post(f'{PEOPLE_URL}ordinary/suspend/', {'days': 3}, format='json')
        self.assertEqual(out.status_code, 400, out.data)
        self.assertIn('emailed', out.data['detail'])
        self.member.refresh_from_db()
        self.assertIsNone(self.member.suspended_until)
        self.assertEqual(len(mail.outbox), 0)

    def test_nothing_locks_the_last_client_or_the_seat_you_are_sitting_in(self):
        mine = self.admin_seat.post(
            f'{PEOPLE_URL}desk_admin/suspend/', {'days': 1, 'reason': 'a test of my own door'}, format='json')
        self.assertEqual(mine.status_code, 400, mine.data)
        self.assertIn('signed in with', mine.data['detail'])

        lonely = self.admin_seat.post(
            f'{PEOPLE_URL}client_owner/suspend/', {'days': 1, 'reason': 'nobody left to unlock it'},
            format='json')
        self.assertEqual(lonely.status_code, 400, lonely.data)
        self.assertIn('last Client seat', lonely.data['detail'])
        self.owner.refresh_from_db()
        self.assertIsNone(self.owner.suspended_until)

        StaffAccount.objects.create(user=make_user('second_client'), role=StaffAccount.Role.SUPERADMIN)
        # With a second Client seat in the world, the first one is administrable.
        both = self.admin_seat.post(
            f'{PEOPLE_URL}client_owner/suspend/', {'days': 1, 'reason': 'a second client is in place'},
            format='json')
        self.assertEqual(both.status_code, 200, both.data)

    def test_reinstating_an_account_that_is_not_suspended_says_so(self):
        out = self.admin_seat.post(f'{PEOPLE_URL}ordinary/reinstate/', {}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertIn('not suspended', out.data['detail'])


class VerifyTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.admin_seat = self.session('desk_admin')

    def test_a_seat_puts_the_tick_on_and_keeps_what_made_it_worth_one(self):
        victim = make_user('shopkeeper')
        out = self.admin_seat.post(
            f'{PEOPLE_URL}shopkeeper/verify/',
            {'verified': True, 'reason': 'business registration checked'}, format='json')
        self.assertEqual(out.status_code, 200, out.data)
        victim.profile.refresh_from_db()
        self.assertTrue(victim.profile.verified)

        entry = AuditLog.objects.filter(action='verify_user').first()
        self.assertEqual(entry.target, 'shopkeeper')
        self.assertIn('business registration checked', entry.detail)
        self.assertIn('verified', Notification.objects.filter(recipient=victim).first().text)

        again = self.admin_seat.post(
            f'{PEOPLE_URL}shopkeeper/verify/', {'verified': True, 'reason': 'twice'}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertIn('already on', again.data['detail'])

        off = self.admin_seat.post(f'{PEOPLE_URL}shopkeeper/verify/', {'verified': False}, format='json')
        self.assertEqual(off.status_code, 200, off.data)
        victim.profile.refresh_from_db()
        self.assertFalse(victim.profile.verified)
        self.assertTrue(AuditLog.objects.filter(action='unverify_user').exists())

    def test_a_tick_without_a_reason_is_refused(self):
        make_user('shopkeeper')
        out = self.admin_seat.post(f'{PEOPLE_URL}shopkeeper/verify/', {'verified': True}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertIn('audit row', out.data['detail'])

    def test_the_directory_counts_verified_accounts_by_the_badge_not_the_email(self):
        verified = make_user('badge_person')
        verified.profile.verified = True
        verified.profile.save(update_fields=['verified'])
        make_user('plain_person', email_verified=True)

        page = self.admin_seat.get(f'{PEOPLE_URL}?status=verified')
        self.assertEqual([item['username'] for item in page.data['results']], ['badge_person'])
        facets = self.admin_seat.get(PEOPLE_URL).data['facets']
        self.assertEqual(facets['verified'], 1)
        row = next(item for item in page.data['results'])
        self.assertTrue(row['verified'])
        # The two kinds of verified are separate facts on the card, not one pill.
        plain = next(item for item in self.admin_seat.get(
            f'{PEOPLE_URL}?q=plain_person').data['results'] if item['username'] == 'plain_person')
        self.assertFalse(plain['verified'])
        self.assertTrue(plain['email_verified'])


class WarnTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.mod_seat = self.session('night_mod')

    def test_a_direct_warning_lands_in_the_bell_the_inbox_and_the_record(self):
        victim = make_user('warned_person')
        out = self.mod_seat.post(
            f'{PEOPLE_URL}warned_person/warn/',
            {'text': 'Repeated harassment reports will end your account.',
             'reason': 'third harassment report'}, format='json')
        self.assertEqual(out.status_code, 200, out.data)
        self.assertFalse(out.data['opted_out'])

        bell = Notification.objects.filter(recipient=victim, kind='warning').first()
        self.assertEqual(bell.text, 'Repeated harassment reports will end your account.')
        self.assertEqual(bell.actor.username, 'night_mod')
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('Repeated harassment reports', mail.outbox[0].body)
        self.assertIn('support@exposing.app', mail.outbox[0].body)
        self.assertIn('Questions? Contact Exposing support', mail.outbox[0].alternatives[0].content)

        entry = AuditLog.objects.filter(action='warn_user').first()
        self.assertEqual(entry.target, 'warned_person')
        self.assertEqual(entry.actor.username, 'night_mod')
        self.assertIn('third harassment report', entry.detail)

    def test_a_warning_is_not_emailed_to_someone_who_turned_emails_off(self):
        victim = make_user('quiet_inbox')
        victim.profile.notify_email = False
        victim.profile.save(update_fields=['notify_email'])

        out = self.mod_seat.post(
            f'{PEOPLE_URL}quiet_inbox/warn/', {'text': 'Stop posting other people photographs.'}, format='json')
        self.assertEqual(out.status_code, 200, out.data)
        self.assertTrue(out.data['opted_out'])
        self.assertEqual(len(mail.outbox), 0, 'the opt-out is honoured')
        self.assertTrue(Notification.objects.filter(recipient=victim, kind='warning').exists(),
                        'the in-app warning still lands')
        self.assertIn('turned warning emails off', out.data['detail'])
        self.assertTrue(AuditLog.objects.filter(action='warn_user').exists(),
                        'and it is still audited')

    def test_a_warning_has_to_say_something(self):
        make_user('warned_person')
        out = self.mod_seat.post(f'{PEOPLE_URL}warned_person/warn/', {'text': '   '}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertIn('words they read', out.data['detail'])
        self.assertFalse(AuditLog.objects.filter(action='warn_user').exists())


class FlagTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.admin_seat = self.session('desk_admin')

    def test_clearing_flags_closes_the_pile_and_the_lockout_and_leaves_decisions_alone(self):
        victim = make_user('flagged_person')
        victim.failed_attempts = 6
        victim.locked_until = timezone.now() + timedelta(minutes=20)
        victim.save(update_fields=['failed_attempts', 'locked_until'])

        reported = self.post_of(author=victim, text='reported but innocent')
        decided = self.post_of(author=victim, text='taken down deliberately')
        decided.status = Post.Status.REMOVED
        decided.save(update_fields=['status'])
        self.pile_on(reported)
        self.reported(reported, kind='post', reporter=make_user())  # a fourth, same target
        self.reported(victim, kind='user', reason='impersonation', reporter=make_user())

        out = self.admin_seat.post(
            f'{PEOPLE_URL}flagged_person/clear-flags/',
            {'reason': 'a bot network filed these reports'}, format='json')
        self.assertEqual(out.status_code, 200, out.data)
        self.assertEqual(out.data['reports_closed'], 5)

        self.assertEqual(
            Report.objects.filter(status__in=(Report.Status.OPEN, Report.Status.REVIEWING)).count(), 0,
            'nothing is left open on the account or its content')
        victim.refresh_from_db()
        self.assertEqual(victim.failed_attempts, 0)
        self.assertIsNone(victim.locked_until)
        decided.refresh_from_db()
        self.assertEqual(decided.status, Post.Status.REMOVED,
                         'a takedown somebody decided is not a flag to clear')
        self.assertTrue(AuditLog.objects.filter(action='clear_spam_flags', target='flagged_person').exists())
        self.assertIn('bot network', AuditLog.objects.filter(action='clear_spam_flags').first().detail)

    def test_the_answer_names_the_content_still_held_and_where_it_is_released(self):
        victim = make_user('half_cleared')
        held = self.post_of(author=victim, text='hidden pending review')
        held.status = Post.Status.HIDDEN
        held.save(update_fields=['status'])
        self.reported(held, reporter=make_user())

        out = self.admin_seat.post(
            f'{PEOPLE_URL}half_cleared/clear-flags/', {'reason': 'the reports were a mistake'}, format='json')
        self.assertEqual(out.status_code, 200, out.data)
        self.assertEqual(out.data['held_posts'], 1)
        self.assertIn('Takedown shelf', out.data['detail'])

    def test_clearing_flags_needs_a_reason(self):
        make_user('flagged_person')
        out = self.admin_seat.post(f'{PEOPLE_URL}flagged_person/clear-flags/', {}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertIn('audit row keeps the reason', out.data['detail'])


class DeleteTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.admin_seat = self.session('desk_admin')

    def test_an_account_is_only_destroyed_once_the_username_is_typed_and_the_reason_given(self):
        victim = make_user('doomed')
        self.post_of(author=victim, text='goes with them')
        self.purse(victim, '0.00')

        wrong = self.admin_seat.post(
            f'{PEOPLE_URL}doomed/delete/', {'confirm': 'somebody', 'reason': 'a duplicate account'},
            format='json')
        self.assertEqual(wrong.status_code, 400, wrong.data)
        self.assertIn('Type the username', wrong.data['detail'])
        self.assertTrue(_alive('doomed'), 'a mistyped confirmation deleted nothing')

        blank = self.admin_seat.post(f'{PEOPLE_URL}doomed/delete/', {'confirm': 'doomed'}, format='json')
        self.assertEqual(blank.status_code, 400)
        self.assertIn('all that survives', blank.data['detail'])

        out = self.admin_seat.post(
            f'{PEOPLE_URL}doomed/delete/',
            {'confirm': 'DOOMED', 'reason': 'a duplicate account used to evade a suspension'}, format='json')
        self.assertEqual(out.status_code, 200, out.data)
        self.assertFalse(_alive('doomed'))
        self.assertEqual(Post.objects.filter(text='goes with them').count(), 0)

        entry = AuditLog.objects.filter(action='delete_user').first()
        self.assertIsNotNone(entry, 'the audit row outlives the account')
        self.assertEqual(entry.target, 'doomed')
        self.assertEqual(entry.actor.username, 'desk_admin')
        self.assertIn('1 posts', entry.detail)
        self.assertIn('evade a suspension', entry.detail)
        self.assertIn('cannot be undone', out.data['detail'])

    def test_an_account_that_owes_or_holds_anything_cannot_be_deleted(self):
        holder = make_user('coin_holder')
        self.purse(holder, '250.00')
        out = self.admin_seat.post(
            f'{PEOPLE_URL}coin_holder/delete/', {'confirm': 'coin_holder', 'reason': 'gone'}, format='json')
        self.assertEqual(out.status_code, 400, out.data)
        self.assertIn('wallet still holds 250.00', out.data['detail'])
        self.assertIn('Coins and payments', out.data['detail'])
        self.assertTrue(_alive('coin_holder'))

        self.purse(holder, '0.00')
        CoinRequest.objects.create(
            user=holder, coins=100, amount=Decimal('1500.00'), status=CoinRequest.Status.PENDING)
        waiting = self.admin_seat.post(
            f'{PEOPLE_URL}coin_holder/delete/', {'confirm': 'coin_holder', 'reason': 'gone'}, format='json')
        self.assertEqual(waiting.status_code, 400)
        self.assertIn('Coin requests', waiting.data['detail'])

        self.purse(holder, '900.00')
        self.campaign(holder, self.post_of(author=holder), budget='900.00')
        running = self.admin_seat.post(
            f'{PEOPLE_URL}coin_holder/delete/', {'confirm': 'coin_holder', 'reason': 'gone'}, format='json')
        self.assertEqual(running.status_code, 400)
        self.assertIn('running 1 campaign', running.data['detail'])
        self.assertIn('Promotions', running.data['detail'])

    def test_the_last_client_seat_and_your_own_seat_survive_a_delete_attempt(self):
        mine = self.admin_seat.post(
            f'{PEOPLE_URL}desk_admin/delete/',
            {'confirm': 'desk_admin', 'reason': 'my own seat, by accident'}, format='json')
        self.assertEqual(mine.status_code, 400)
        self.assertIn('signed in with', mine.data['detail'])

        lonely = self.admin_seat.post(
            f'{PEOPLE_URL}client_owner/delete/',
            {'confirm': 'client_owner', 'reason': 'the only client'}, format='json')
        self.assertEqual(lonely.status_code, 400)
        self.assertIn('last Client seat', lonely.data['detail'])
        self.assertTrue(_alive('client_owner'))

    def test_deleting_a_staff_seat_takes_the_console_with_it(self):
        seat = StaffAccount.objects.create(user=make_user('moddemo'), role=StaffAccount.Role.MODERATOR)
        self.purse(seat.user, '0.00')
        out = self.admin_seat.post(
            f'{PEOPLE_URL}moddemo/delete/', {'confirm': 'moddemo', 'reason': 'left the company'},
            format='json')
        self.assertEqual(out.status_code, 200, out.data)
        self.assertFalse(StaffAccount.objects.filter(user__username='moddemo').exists())


class GateTests(ReviewTestCase):
    def test_an_ordinary_account_is_refused_the_directory_altogether(self):
        member = auth_client(self.member)
        out = member.get(PEOPLE_URL)
        self.assertEqual(out.status_code, 403)
        self.assertEqual(out.data['code'], 'staff_only')

    def test_a_seat_may_read_everybody_and_sign_nobody(self):
        mod = self.session('night_mod')
        owner = self.session('client_owner')
        denied = owner.post(
            '/api/admin/staff/night_mod/', {'denied_keys': ['user_actions', 'warnings']}, format='json')
        self.assertEqual(denied.status_code, 200, denied.data)

        self.assertEqual(mod.get(PEOPLE_URL).status_code, 200, 'reading is still theirs')

        suspend = mod.post(f'{PEOPLE_URL}ordinary/suspend/', {'days': 1, 'reason': 'because'}, format='json')
        self.assertEqual(suspend.status_code, 403)
        self.assertEqual(suspend.data['permission'], 'user_actions')
        self.assertEqual(suspend.data['label'], 'Suspend, reinstate, verify, delete')

        warn = mod.post(f'{PEOPLE_URL}ordinary/warn/', {'text': 'a warning'}, format='json')
        self.assertEqual(warn.status_code, 403)
        self.assertEqual(warn.data['permission'], 'warnings')

        self.member.refresh_from_db()
        self.assertIsNone(self.member.suspended_until, 'and the refusal wrote nothing')

        page = mod.get(PEOPLE_URL)
        self.assertEqual(page.data['can'], {'actions': False, 'warn': False})
        self.assertEqual(page.data['results'][0].get('suspension'), None)

    def test_a_suspended_staff_member_loses_the_console_at_their_next_call(self):
        mod = self.session('night_mod')
        owner = self.session('client_owner')

        self.assertEqual(mod.get(PEOPLE_URL).status_code, 200, 'the console opens while the seat is live')

        down = owner.post(
            f'{PEOPLE_URL}night_mod/suspend/', {'days': 2, 'reason': 'an account level bar'}, format='json')
        self.assertEqual(down.status_code, 200, down.data)

        # The refusal is a 401, not the console's own 403: the API authenticator
        # rejects a suspended account's cookie on every request, so a moderator
        # who is suspended mid-shift cannot read one more screen, from this
        # console or anywhere else on the platform.
        refused = mod.get(PEOPLE_URL)
        self.assertEqual(refused.status_code, 401)

        back = owner.post(f'{PEOPLE_URL}night_mod/reinstate/', {}, format='json')
        self.assertEqual(back.status_code, 200, back.data)
        self.assertEqual(mod.get(PEOPLE_URL).status_code, 200, 'reinstating hands the console back')


def _alive(username):
    return User.objects.filter(username=username).exists()
