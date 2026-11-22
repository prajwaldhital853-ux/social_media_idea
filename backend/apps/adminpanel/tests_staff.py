"""Contract 6.1 RBAC: three roles, explicit grants, and nobody edits their own seat."""

from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import RefreshSession
from apps.common.testutils import make_user
from apps.moderation.models import AuditLog

from . import rbac
from .models import StaffAccount
from .tests_session import LOGIN_URL, PASSWORD, SESSION_URL, first_sign_in

STAFF_URL = '/api/admin/staff/'
GRANT_URL = '/api/admin/staff/grant/'
CATALOGUE_URL = '/api/admin/permissions/'


class RbacTestCase(TestCase):
    """A Client seat, an Admin seat and a Moderator seat, each signed in."""

    def setUp(self):
        cache.clear()
        self.owner = make_user('client_owner', password=PASSWORD, is_staff=True, is_superuser=True)
        self.admin = make_user('desk_admin', password=PASSWORD, is_staff=True)
        self.mod = make_user('night_mod', password=PASSWORD, is_staff=True)
        self.member = make_user('ordinary', password=PASSWORD)

    def session(self, username):
        """A signed-in console tab for that person: password, then a live code."""
        client = APIClient()
        granted, started = first_sign_in(client, username=username)
        self.assertEqual(granted.status_code, 200, (granted.status_code, granted.data))
        self.assertEqual(started['code'], 'two_factor_enrolment')
        return client

    def seat(self, user):
        return StaffAccount.objects.get(user=user)


class SeatGrantTests(RbacTestCase):
    def test_the_client_appoints_a_moderator(self):
        owner = self.session('client_owner')
        granted = owner.post(GRANT_URL, {'username': 'night_mod', 'role': 'moderator'}, format='json')
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.data['role'], 'moderator')
        self.assertFalse(granted.data['enrolled'], 'a new seat has not proved an authenticator yet')

        self.mod.refresh_from_db()
        self.assertTrue(self.mod.is_staff, 'the flag every existing admin endpoint already checks')
        seat = self.seat(self.mod)
        self.assertEqual(seat.granted_by, self.owner)
        self.assertTrue(AuditLog.objects.filter(actor=self.owner, action='grant_staff', target='night_mod').exists())

    def test_a_moderator_cannot_appoint_anyone(self):
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        mod = self.session('night_mod')
        response = mod.post(GRANT_URL, {'username': 'desk_admin', 'role': 'moderator'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'permission_required')
        self.assertEqual(response.data['permission'], 'staff_grant')

    def test_an_admin_creates_moderators_but_not_admins(self):
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        admin = self.session('desk_admin')

        ok = admin.post(GRANT_URL, {'username': 'ordinary', 'role': 'moderator'}, format='json')
        self.assertEqual(ok.status_code, 200)

        above = admin.post(GRANT_URL, {'username': 'night_mod', 'role': 'admin'}, format='json')
        self.assertEqual(above.status_code, 403)

        peer = admin.post(GRANT_URL, {'username': 'desk_admin', 'role': 'moderator'}, format='json')
        self.assertEqual(peer.status_code, 403, 'an admin seat sits above what an admin may move, including their own')

    def test_nobody_narrows_their_own_seat(self):
        owner = self.session('client_owner')
        response = owner.post(f'{STAFF_URL}client_owner/', {'denied_keys': ['coins_review']}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('another staff account', response.data['detail'])

        # A colleague with the same standing can, which is the point of the rule.
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        peer = self.session('desk_admin')
        changed = peer.post(f'{STAFF_URL}night_mod/', {'denied_keys': ['reports']}, format='json')
        self.assertEqual(changed.status_code, 200)
        self.assertNotIn('reports', changed.data['permissions'])

    def test_an_admin_cannot_touch_the_clients_seat(self):
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.owner, role=StaffAccount.Role.SUPERADMIN)
        admin = self.session('desk_admin')
        response = admin.post(f'{STAFF_URL}client_owner/revoke/', {}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_revoking_a_seat_ends_the_session_and_the_refresh_tokens(self):
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        RefreshSession.objects.create(
            user=self.mod, jti='live-token', expires_at=timezone.now() + timedelta(days=7),
        )
        owner = self.session('client_owner')

        revoked = owner.post(f'{STAFF_URL}night_mod/revoke/', {}, format='json')
        self.assertEqual(revoked.status_code, 200)
        self.assertFalse(revoked.data['is_enabled'])

        self.mod.refresh_from_db()
        self.assertFalse(self.mod.is_staff)
        self.assertTrue(RefreshSession.objects.filter(user=self.mod, revoked_at__isnull=False).exists())

        # No seat, so not a staff account: the console door does not even recognise them.
        door = APIClient().post(LOGIN_URL, {'username': 'night_mod', 'password': PASSWORD}, format='json')
        self.assertEqual(door.status_code, 401)

    def test_a_disabled_seat_stops_working_inside_its_own_admin_window(self):
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        client = self.session('night_mod')
        self.assertEqual(client.get(SESSION_URL).status_code, 200)

        seat = self.seat(self.mod)
        seat.is_enabled = False
        seat.save(update_fields=['is_enabled'])

        response = client.get(SESSION_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'staff_disabled')

    def test_a_seat_switched_off_from_the_roster_is_told_its_access_ended(self):
        # Switching a seat off also clears is_staff, so the door has to read the
        # roster row first or it answers "you are not staff" to a revoked seat.
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        admin = self.session('desk_admin')
        mod = self.session('night_mod')
        self.assertEqual(mod.get(SESSION_URL).status_code, 200)

        ended = admin.post(f'{STAFF_URL}night_mod/', {'is_enabled': False}, format='json')
        self.assertEqual(ended.status_code, 200)
        self.mod.refresh_from_db()
        self.assertFalse(self.mod.is_staff)

        response = mod.get(SESSION_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'staff_disabled')

    def test_the_last_superadmin_seat_cannot_be_switched_off(self):
        StaffAccount.objects.create(user=self.owner, role=StaffAccount.Role.SUPERADMIN)
        owner = self.session('client_owner')
        response = owner.post(f'{STAFF_URL}client_owner/', {'is_enabled': False}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('superadmin', response.data['detail'])


class PermissionKeyTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)

    def test_moderator_defaults_match_the_contract(self):
        keys = set(rbac.permissions_for(self.seat(self.mod)))
        self.assertEqual(
            keys,
            {'overview', 'reports', 'content', 'listings', 'notices', 'users', 'user_actions', 'warnings'},
        )
        self.assertNotIn('coins_view', keys, 'clause 6.1: payment screens are not a moderator default')

    def test_a_grant_adds_to_the_role_instead_of_replacing_it(self):
        owner = self.session('client_owner')
        changed = owner.post(f'{STAFF_URL}night_mod/', {'granted_keys': ['coins_view', 'coins_review']}, format='json')
        self.assertEqual(changed.status_code, 200)
        self.assertIn('coins_view', changed.data['permissions'])
        self.assertIn('reports', changed.data['permissions'])
        self.assertTrue(rbac.can(self.seat(self.mod), 'coins_review'))

    def test_a_denied_key_beats_an_older_grant(self):
        seat = self.seat(self.mod)
        seat.granted_keys = ['coins_view']
        seat.denied_keys = ['reports']
        seat.save(update_fields=['granted_keys', 'denied_keys'])
        keys = set(rbac.permissions_for(seat))
        self.assertIn('coins_view', keys)
        self.assertNotIn('reports', keys, 'the revocation was written last, so it wins')

    def test_denying_a_moderator_default_closes_the_screen(self):
        owner = self.session('client_owner')
        changed = owner.post(f'{STAFF_URL}night_mod/', {'denied_keys': ['reports']}, format='json')
        self.assertNotIn('reports', changed.data['permissions'])

    def test_an_unknown_key_is_refused_not_stored(self):
        owner = self.session('client_owner')
        response = owner.post(f'{STAFF_URL}night_mod/', {'granted_keys': ['launch_missiles']}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('launch_missiles', response.data['detail'])
        self.assertEqual(self.seat(self.mod).granted_keys, [])

    def test_the_gate_names_the_permission_that_was_missing(self):
        mod = self.session('night_mod')
        response = mod.get(STAFF_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'permission_required')
        self.assertEqual(response.data['permission'], 'staff_view')
        self.assertEqual(response.data['label'], 'Staff roster')

    def test_the_catalogue_describes_every_key_for_the_ui(self):
        admin = self.session('desk_admin')
        catalogue = admin.get(CATALOGUE_URL)
        self.assertEqual(catalogue.status_code, 200)
        self.assertEqual({item['key'] for item in catalogue.data['permissions']}, set(rbac.ALL_KEYS))
        self.assertTrue(all(item['label'] and item['group'] for item in catalogue.data['permissions']))
        self.assertIn('payments', {group['id'] for group in catalogue.data['groups']})

    def test_a_moderator_reads_their_own_screens_without_the_roster_key(self):
        # "What can I open?" is the one screen list a seat can always read, so the
        # session payload carries the labels instead of pointing at staff_view.
        mod = self.session('night_mod')
        self.assertEqual(mod.get(CATALOGUE_URL).data['code'], 'permission_required')

        session = mod.get(SESSION_URL)
        self.assertEqual(session.status_code, 200)
        held = {entry['key'] for entry in session.data['permission_keys']}
        self.assertEqual(held, set(session.data['permissions']))
        self.assertNotIn('coins_view', held)
        self.assertTrue(all(entry['label'] and entry['group_label'] for entry in session.data['permission_keys']))


class TwoFactorResetTests(RbacTestCase):
    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)

    def test_resetting_an_authenticator_forces_enrolment_again(self):
        self.session('night_mod')  # enrols the moderator
        admin = self.session('desk_admin')
        response = admin.post(f'{STAFF_URL}night_mod/reset-two-factor/', {}, format='json')
        self.assertEqual(response.status_code, 200)

        seat = self.seat(self.mod)
        self.assertFalse(seat.is_enrolled)
        self.assertEqual(seat.recovery_codes, [])
        self.assertEqual(seat.totp_secret, '')

        # A lost phone is not a back door: the next sign-in re-enrols from scratch.
        fresh = APIClient()
        again = fresh.post(LOGIN_URL, {'username': 'night_mod', 'password': PASSWORD}, format='json')
        self.assertEqual(again.status_code, 202)
        self.assertEqual(again.data['code'], 'two_factor_enrolment')

    def test_an_admin_cannot_reset_the_clients_authenticator(self):
        StaffAccount.objects.create(user=self.owner, role=StaffAccount.Role.SUPERADMIN)
        admin = self.session('desk_admin')
        response = admin.post(f'{STAFF_URL}client_owner/reset-two-factor/', {}, format='json')
        self.assertEqual(response.status_code, 403)
