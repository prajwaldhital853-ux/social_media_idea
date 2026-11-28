"""Contract 6.6: the wording on the first-load card, and who is allowed to change it.

Two things the tests have to hold at once: the card is readable by somebody who
does not have an account, and it is only ever written from the desk, so the open
door is checked for what it leaks as well as for what it shows, and the desk is
checked for the fallback that lets a blank box still be a sentence.
"""

from django.test import TestCase

from apps.common.testutils import auth_client
from apps.moderation.models import AuditLog

from . import settings_store, views_welcome
from .models import StaffAccount
from .tests_staff import RbacTestCase

DESK_URL = '/api/admin/welcome/'
CARD_URL = '/api/welcome/'


class WelcomeTestCase(RbacTestCase):
    def desk(self):
        return self.session('client_owner')


class CardTests(WelcomeTestCase):
    def test_the_card_arrives_with_words_in_it_before_the_client_sends_any(self):
        """Seven days is the Client’s deadline, not the visitor’s problem."""
        out = self.client.get(CARD_URL)
        self.assertEqual(out.status_code, 200)
        self.assertEqual(set(out.data), {'message', 'tagline', 'contact'})
        self.assertTrue(out.data['message'].startswith('Welcome to Exposing'))
        self.assertEqual(out.data['tagline'], 'Expose the work.')
        self.assertEqual(out.data['contact'], [{'label': 'Email', 'value': 'support@exposing.app'}])

    def test_the_open_door_shows_the_card_and_none_of_the_knobs_behind_it(self):
        out = self.client.get(CARD_URL)
        self.assertNotIn('lines', out.data)
        self.assertNotIn('welcome_message', str(out.data))
        self.assertNotIn('support@exposing.app', str(out.data['tagline']))

    def test_the_card_moves_when_the_desk_writes(self):
        desk = self.desk()
        saved = desk.post(DESK_URL, {'message': 'A hundred small studios, one feed.',
                                     'tagline': 'Show the work.'}, format='json')
        self.assertEqual(saved.status_code, 200)
        out = self.client.get(CARD_URL)
        self.assertEqual(out.data['message'], 'A hundred small studios, one feed.')
        self.assertEqual(out.data['tagline'], 'Show the work.')
        self.assertIn('next first load', saved.data['detail'])
        self.assertIn('welcome message', saved.data['detail'])

    def test_a_contact_the_client_filled_in_appears_and_an_empty_one_does_not(self):
        desk = self.desk()
        self.assertEqual(len(self.client.get(CARD_URL).data['contact']), 1)

        with_phone = desk.post(DESK_URL, {'phone': '+977-1-4567890', 'form': ''}, format='json')
        self.assertEqual(with_phone.status_code, 200)
        self.assertEqual(
            [line['label'] for line in self.client.get(CARD_URL).data['contact']],
            ['Email', 'Phone'])

    def test_the_desk_shows_each_line_with_the_platforms_own_wording_behind_it(self):
        page = self.desk().get(DESK_URL)
        self.assertEqual(page.status_code, 200)
        self.assertEqual([line['field'] for line in page.data['lines']],
                         ['message', 'tagline', 'email', 'phone', 'form', 'report_inbox',
                          'request_inbox', 'console_url'])
        message = page.data['lines'][0]
        self.assertEqual(message['limit'], 300)
        self.assertTrue(message['value'])
        self.assertFalse(message['set'], 'nobody has written it yet, so the default is what shows')
        self.assertIsNone(message['by'])
        self.assertEqual(page.data['card']['message'], message['value'])


class DeskWriteTests(WelcomeTestCase):
    def test_an_empty_line_hands_the_wording_back_to_the_platform(self):
        desk = self.desk()
        desk.post(DESK_URL, {'tagline': 'Made by the people who use it.'}, format='json')
        self.assertEqual(self.client.get(CARD_URL).data['tagline'], 'Made by the people who use it.')

        back = desk.post(DESK_URL, {'tagline': ''}, format='json')
        self.assertEqual(back.status_code, 200)
        self.assertEqual(self.client.get(CARD_URL).data['tagline'], 'Expose the work.')
        line = [item for item in back.data['lines'] if item['field'] == 'tagline'][0]
        self.assertFalse(line['set'])

    def test_a_line_too_long_for_the_card_is_refused_naming_the_room_it_has(self):
        desk = self.desk()
        too_long = desk.post(DESK_URL, {'message': 'w' * 301, 'tagline': 'x' * 121}, format='json')
        self.assertEqual(too_long.status_code, 400)
        self.assertIn('301 characters and the line holds 300', too_long.data['detail'])
        self.assertIn('121 characters and the line holds 120', too_long.data['detail'])
        self.assertEqual(self.client.get(CARD_URL).data['message'],
                         settings_store.get('welcome_message'), 'a refused write changed nothing')

    def test_writing_the_same_words_twice_is_not_a_second_edit(self):
        desk = self.desk()
        body = {'message': 'One feed for every studio on the platform.', 'tagline': 'Show the work.'}
        self.assertEqual(desk.post(DESK_URL, body, format='json').status_code, 200)
        twice = desk.post(DESK_URL, body, format='json')
        self.assertEqual(twice.status_code, 400)
        self.assertIn('already says exactly this', twice.data['detail'])
        self.assertEqual(AuditLog.objects.filter(action='welcome_text').count(), 1)

    def test_an_already_empty_line_is_not_written_again_because_it_falls_back(self):
        """The card shows the platform's line either way; saving it twice is not two edits."""
        desk = self.desk()
        self.assertEqual(desk.post(DESK_URL, {'tagline': 'Show the work.'}, format='json').status_code, 200)
        self.assertEqual(desk.post(DESK_URL, {'tagline': ''}, format='json').status_code, 200,
                         'emptying a line that had words in it is an edit')
        again = desk.post(DESK_URL, {'tagline': ''}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertIn('already says exactly this', again.data['detail'])
        self.assertEqual(AuditLog.objects.filter(action='welcome_text').count(), 2)
        self.assertEqual(self.client.get(CARD_URL).data['tagline'], 'Expose the work.')

    def test_every_write_leaves_a_row_naming_the_person_and_the_lines(self):
        desk = self.desk()
        desk.post(DESK_URL, {'message': 'Studio to studio.', 'phone': '+977-1-4567890'}, format='json')

        entry = AuditLog.objects.get(action='welcome_text')
        self.assertEqual(entry.actor, self.owner)
        self.assertEqual(entry.target, 'first-load wording')
        self.assertIn('Welcome message', entry.detail)
        self.assertIn('Phone', entry.detail)

        line = [item for item in desk.get(DESK_URL).data['lines'] if item['field'] == 'message'][0]
        self.assertEqual(line['by'], 'client_owner')
        self.assertTrue(line['set'])


class DeskGateTests(WelcomeTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)

    def test_a_moderator_reads_nothing_of_the_wording_and_changes_less(self):
        mod = self.session('night_mod')
        refused = mod.get(DESK_URL)
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['permission'], 'welcome_text')
        self.assertEqual(mod.post(DESK_URL, {'tagline': 'Mine now.'}, format='json').status_code, 403)
        self.assertEqual(self.client.get(CARD_URL).data['tagline'], 'Expose the work.')

    def test_an_admin_holds_the_pen_the_contract_gives_staff(self):
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        desk = self.session('desk_admin')
        self.assertEqual(desk.get(DESK_URL).status_code, 200)
        self.assertEqual(desk.post(DESK_URL, {'tagline': 'Written by an admin.'}, format='json').status_code, 200)
        self.assertEqual(self.client.get(CARD_URL).data['tagline'], 'Written by an admin.')

    def test_a_signed_in_stranger_cannot_reach_the_desk(self):
        stranger = auth_client(self.member)
        refused = stranger.get(DESK_URL)
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['code'], 'staff_only')


class CardShapeTests(TestCase):
    def test_the_card_is_built_from_the_settings_and_nothing_else(self):
        """The open door and the enforcement email read the same keys."""
        self.assertEqual(sorted(line[0] for line in views_welcome.CONTACT_LABELS),
                         ['contact_email', 'contact_form', 'contact_phone'])
        self.assertEqual(views_welcome.card()['tagline'], settings_store.get('tagline'))
