"""Contract 6.9, first half: the rules that decide how often a person may act.

The desk is where the platform's own refusals stop being numbers in a settings file.
So the tests are about three things a Client would actually check: that a typed limit
changes what the open door answers, that the pile a seat sets is the pile every screen
counts with, and that a rule nobody can reach is not a rule — a Moderator without
`spam_settings` is refused the desk in the same sentence the permission catalogue
uses, while the door the member site reads stays open because it holds no person's
data.

The blocked-link list is the part that could have become a second table and a second
verb. It is not: `kind=link` goes through the platform-rules doors, so a domain, a
word and a prohibited item are one list with one audit trail, and this file proves
the desk shows what the rules screen wrote rather than its own copy of it.
"""

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.auth import issue_access
from apps.comments.models import Comment
from apps.common.testutils import make_user
from apps.marketplace.models import Listing
from apps.moderation.models import AuditLog, Report
from apps.posts.models import Post

from . import people, spam
from .models import AdminSetting, PolicyTerm, StaffAccount
from .tests_staff import RbacTestCase

DESK_URL = '/api/admin/spam/'
FLAGS_URL = '/api/admin/spam/flags/'
CONFIG_URL = '/api/spam/config/'
TERMS_URL = '/api/admin/policy/terms/'


class SpamDeskTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        self.desk = self.session('client_owner')

    def test_the_desk_shows_the_limits_in_three_blocks(self):
        got = self.desk.get(DESK_URL)
        self.assertEqual(got.status_code, 200)
        blocks = {item['id'] for item in got.data['blocks']}
        self.assertEqual(blocks, {'rate', 'new', 'pile'})
        keys = [line['key'] for block in got.data['blocks'] for line in block['lines']]
        for wanted in ('spam_signup_per_hour', 'spam_post_per_hour', 'spam_new_account_hours',
                       'alert_report_pile', 'spam_autohide', 'spam_link_block'):
            self.assertIn(wanted, keys)

    def test_which_limits_the_site_already_refuses_is_said_per_line(self):
        got = self.desk.get(DESK_URL)
        lines = {line['key']: line for block in got.data['blocks'] for line in block['lines']}
        self.assertTrue(lines['spam_signup_per_hour']['enforced'])
        self.assertFalse(lines['spam_post_per_hour']['enforced'],
                         'a ceiling the composer would have to read is not yet a refusal')
        self.assertEqual(got.data['enforced'], list(spam.ENFORCED))

    def test_typing_a_limit_changes_what_the_open_door_answers(self):
        saved = self.desk.post(DESK_URL, {'spam_post_per_hour': '2'}, format='json')
        self.assertEqual(saved.status_code, 200)
        open_door = APIClient().get(CONFIG_URL)
        self.assertEqual(open_door.status_code, 200, 'the member site does not sign in to ask')
        self.assertEqual(open_door.data['limits']['spam_post_per_hour'], 2)
        self.assertEqual(open_door.data['limits']['spam_signup_per_hour'], 3,
                         'a limit nobody typed is still the platform’s own answer')

    def test_a_rule_that_is_not_a_number_is_refused_in_words_and_not_written(self):
        bad = self.desk.post(DESK_URL, {'spam_post_per_hour': 'soon'}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertFalse(AdminSetting.objects.filter(key='spam_post_per_hour').exists())

    def test_one_reporter_is_not_a_pile(self):
        """A threshold of 1 makes every single complaint an automatic takedown."""
        low = self.desk.post(DESK_URL, {'alert_report_pile': '1'}, format='json')
        self.assertEqual(low.status_code, 400)
        self.assertIn('smallest pile', low.data['detail'])

    def test_the_pile_a_seat_sets_is_the_number_every_screen_counts_with(self):
        self.desk.post(DESK_URL, {'alert_report_pile': '5'}, format='json')
        self.assertEqual(spam.report_threshold(), 5)
        self.assertEqual(people.threshold(), 5)
        self.assertEqual(people.facets()['auto_hide_at'], 5)

    def test_the_environment_value_stands_until_a_person_turns_the_knob(self):
        """The desk must not quietly overrule the number the server was booted with."""
        self.assertEqual(spam.report_threshold(), int(spam.django_settings.EXPOSING_REPORT_THRESHOLD))
        AdminSetting.objects.create(key='alert_report_pile', value='')
        self.assertEqual(spam.report_threshold(), int(spam.django_settings.EXPOSING_REPORT_THRESHOLD))

    def test_a_switch_is_written_as_a_switch_and_read_back_as_a_boolean(self):
        off = self.desk.post(DESK_URL, {'spam_autohide': ''}, format='json')
        self.assertEqual(off.status_code, 200)
        open_door = APIClient().get(CONFIG_URL)
        self.assertFalse(open_door.data['auto_hide']['enabled'])
        self.assertFalse(self.desk.get(DESK_URL).data['autohide'])

    def test_the_desk_writes_one_audit_row_naming_what_changed(self):
        self.desk.post(DESK_URL, {'spam_post_per_hour': '7', 'spam_comment_per_hour': '3'}, format='json')
        row = AuditLog.objects.filter(action='spam_settings').first()
        self.assertIsNotNone(row)
        self.assertEqual(row.actor, self.owner)
        self.assertIn('posts one account may make in an hour', row.detail)

    def test_a_key_that_is_not_a_knob_on_this_desk_cannot_be_smuggled_in(self):
        pushed = self.desk.post(DESK_URL, {'coin_price': '999'}, format='json')
        self.assertEqual(pushed.status_code, 400, 'nothing on the desk was touched, so there is nothing to save')
        self.assertFalse(AdminSetting.objects.filter(key='coin_price').exists())

    def test_a_moderator_is_refused_the_desk_and_shown_the_key_to_ask_for(self):
        night = self.session('night_mod')
        got = night.get(DESK_URL)
        self.assertEqual(got.status_code, 403)
        self.assertEqual(got.data['permission'], 'spam_settings')

    def test_an_ordinary_account_cannot_read_the_platform_rules_at_all(self):
        plain = APIClient()
        self.assertIn(plain.get(DESK_URL).status_code, (401, 403))
        signed_up = make_user('nosy_member', password='Test-Pass-9271')
        plain.cookies['exposing_access'] = issue_access(signed_up)
        turned_away = plain.get(DESK_URL)
        self.assertEqual(turned_away.status_code, 403)
        self.assertEqual(turned_away.data['code'], 'staff_only')


class BlockedLinkTests(RbacTestCase):
    """Links are the rules table with a third kind, not a second list."""

    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        self.desk = self.session('client_owner')

    def test_a_domain_written_on_the_rules_screen_appears_on_the_desk(self):
        added = self.desk.post(TERMS_URL, {'kind': 'link', 'text': 'Short.Example.COM', 'note': 'phishing'},
                               format='json')
        self.assertEqual(added.status_code, 201, added.data)
        self.assertEqual(added.data['kind'], 'link')
        self.assertEqual(added.data['text'], 'short.example.com', 'one case, or the list stops matching half of it')

        desk = self.desk.get(DESK_URL).data
        self.assertEqual([item['text'] for item in desk['links']], ['short.example.com'])
        self.assertEqual(spam.blocked_links(), ['short.example.com'])
        self.assertIn('short.example.com', APIClient().get(CONFIG_URL).data['blocked_links'])

    def test_a_link_and_a_word_that_look_alike_are_two_entries(self):
        self.desk.post(TERMS_URL, {'kind': 'word', 'text': 'example.com'}, format='json')
        self.desk.post(TERMS_URL, {'kind': 'link', 'text': 'example.com'}, format='json')
        self.assertEqual(PolicyTerm.objects.filter(text='example.com').count(), 2)
        self.assertEqual(self.desk.get(DESK_URL).data['words'], 1)
        self.assertEqual(len(self.desk.get(DESK_URL).data['links']), 1)

    def test_switching_a_link_off_takes_it_out_of_what_the_site_is_told(self):
        added = self.desk.post(TERMS_URL, {'kind': 'link', 'text': 'spam.example'}, format='json')
        self.desk.post(f'{TERMS_URL}{added.data["id"]}/', {'is_active': False}, format='json')
        self.assertNotIn('spam.example', APIClient().get(CONFIG_URL).data['blocked_links'])
        self.assertEqual(len(self.desk.get(DESK_URL).data['links']), 1,
                         'the desk still lists it, dimmed — a seat has to see what was switched off')


class PublicConfigTests(RbacTestCase):
    def test_the_door_publishes_the_new_account_rules_without_a_login(self):
        self.session('client_owner').post(DESK_URL, {'spam_new_account_hours': '24', 'spam_new_account_verify': '1'},
                                          format='json')
        answered = APIClient().get(CONFIG_URL)
        self.assertEqual(answered.data['new_account'], {'hold_hours': 24, 'posts_per_day': 5, 'verify_first': True})

    def test_it_carries_the_words_and_links_the_platform_will_not_carry(self):
        owner = self.session('client_owner')
        owner.post(TERMS_URL, {'kind': 'word', 'text': 'firearm'}, format='json')
        owner.post(TERMS_URL, {'kind': 'link', 'text': 'bit.ly'}, format='json')
        answered = APIClient().get(CONFIG_URL)
        self.assertIn('firearm', answered.data['blocked_words'])
        self.assertIn('bit.ly', answered.data['blocked_links'])
        self.assertNotIn('auto_hide_at', answered.data, 'a count of complaints is not a rule to enforce at sign-up')


class FlaggedListTests(RbacTestCase):
    """What the pile has already pulled, and who it was pulled from."""

    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        self.desk = self.session('client_owner')
        self.author = make_user('seller_of_it', password='Test-Pass-9271')
        self.post = Post.objects.create(author=self.author, text='a reel of the new studio')
        self.comment = Comment.objects.create(post=self.post, author=self.author, text='buy from me')
        self.listing = Listing.objects.create(
            seller=self.author, title='a thing', description='nothing', price=10, condition='new',
        )

    def reporters(self, count, target, kind='post', reason='spam', status=Report.Status.OPEN):
        self.pile = getattr(self, 'pile', 0) + 1
        for index in range(count):
            who = make_user(f'watch{self.pile}_{index}_{kind}{target.pk}', password='Test-Pass-9271')
            Report.objects.create(reporter=who, target_type=kind, target_id=str(target.pk),
                                  reason=reason, details='said so', status=status)

    def test_the_pile_is_listed_with_who_it_was_filed_on_and_how_many_said_it(self):
        self.reporters(4, self.post)
        self.reporters(2, self.comment, kind='comment', reason='harassment')
        got = self.desk.get(FLAGS_URL)
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.data['threshold'], spam.report_threshold())
        rows = {item['kind']: item for item in got.data['content']}
        self.assertEqual(rows['post']['reporters'], 4)
        self.assertEqual(rows['post']['owner']['username'], 'seller_of_it')
        self.assertNotIn('comment', rows, 'two reporters is not the pile the desk pulled for')

    def test_the_reasons_under_a_pile_are_counted_and_ordered(self):
        self.reporters(3, self.post, reason='spam')
        self.reporters(1, self.post, reason='harassment')
        row = self.desk.get(FLAGS_URL).data['content'][0]
        self.assertEqual(row['reasons'][0]['reason'], 'spam')
        self.assertEqual([item['reason'] for item in row['reasons']], ['spam', 'harassment'])

    def test_content_the_pile_already_took_down_is_said_so_rather_than_shown_as_live(self):
        self.reporters(4, self.post)
        self.post.status = Post.Status.HIDDEN
        self.post.save(update_fields=['status'])
        row = self.desk.get(FLAGS_URL).data['content'][0]
        self.assertFalse(row['live'])
        self.assertEqual(row['state_word'], 'held')

    def test_a_closed_complaint_stops_being_a_flag(self):
        self.reporters(4, self.post)
        Report.objects.filter(target_id=str(self.post.pk)).update(
            status=Report.Status.DISMISSED, resolved_at=timezone.now())
        self.assertEqual(self.desk.get(FLAGS_URL).data['content'], [])

    def test_an_account_under_a_pile_on_its_own_name_is_listed_too(self):
        self.reporters(4, self.author, kind='user')
        got = self.desk.get(FLAGS_URL)
        self.assertEqual(got.data['accounts_total'], 1)
        self.assertEqual(got.data['accounts'][0]['username'], 'seller_of_it')

    def test_a_listing_pile_names_the_seller_behind_it(self):
        self.reporters(3, self.listing, kind='listing')
        self.desk.post(DESK_URL, {'alert_report_pile': '3'}, format='json')
        row = self.desk.get(FLAGS_URL).data['content'][0]
        self.assertEqual(row['kind'], 'listing')
        self.assertEqual(row['owner']['username'], 'seller_of_it')

    def test_a_report_on_a_deleted_post_is_still_counted_and_says_its_target_is_gone(self):
        self.reporters(4, self.post)
        pk = self.post.pk
        self.post.delete()
        row = self.desk.get(FLAGS_URL).data['content'][0]
        self.assertEqual(str(pk), str(row['id']))
        self.assertTrue(row['gone'])

    def test_the_queue_owner_reads_it_and_a_seat_without_the_reports_key_does_not(self):
        night = self.session('night_mod')
        self.assertEqual(night.get(FLAGS_URL).status_code, 200,
                         'a moderator works this pile all day under the reports key')
        StaffAccount.objects.filter(user=self.mod).update(denied_keys=['reports'])
        self.assertEqual(night.get(FLAGS_URL).status_code, 403)


class ThresholdWiringTests(RbacTestCase):
    """The desk's number has to reach the checks, or the two disagree on screen."""

    def test_the_alert_for_a_pile_uses_the_number_the_desk_was_given(self):
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        owner = self.session('client_owner')
        author = make_user('the_poor_one', password='Test-Pass-9271')
        subject = Post.objects.create(author=author, text='nothing worth two complaints')
        for index in range(2):
            who = make_user(f'watcher{index}', password='Test-Pass-9271')
            Report.objects.create(reporter=who, target_type='post', target_id=str(subject.pk), reason='spam')
        from . import alerts
        before = [row.key for row in alerts.scan()]
        self.assertNotIn(f'report_pile:post:{subject.pk}', before, 'two is below the pile it ships with')
        owner.post(DESK_URL, {'alert_report_pile': '2'}, format='json')
        raised = [row for row in alerts.scan() if row.kind == 'report_pile']
        self.assertEqual([row.key for row in raised], [f'report_pile:post:{subject.pk}'])
        self.assertIn('2 open reports', raised[0].title)

    def test_the_desk_the_flags_screen_and_the_alerts_all_count_with_one_number(self):
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        owner = self.session('client_owner')
        owner.post(DESK_URL, {'alert_report_pile': '7'}, format='json')
        flags = owner.get(FLAGS_URL).data
        desk = owner.get(DESK_URL).data
        self.assertEqual(flags['threshold'], 7)
        self.assertEqual([line['value'] for block in desk['blocks'] for line in block['lines']
                          if line['key'] == 'alert_report_pile'], [7])
        self.assertEqual(people.facets()['auto_hide_at'], 7)
