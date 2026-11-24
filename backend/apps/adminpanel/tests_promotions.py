"""Contract 6.8: paid reach, the seat that signs it off, and the dials that spend it.

A campaign is different from a report or a payment slip because a decision here
moves coins that have already been taken. So these tests count the ledger rows
around every verb, not only the status column: approving must write nothing,
refusing must hand back exactly the part of the run the payer never got, and a
stop must be able to *withhold* that money when the reason is a broken rule —
which is the one place in this console where the platform keeps somebody's coins
after ending what they bought.

The other half is the reach itself. The contract promises an Admin can retune the
ranking without a deploy, so the tests read the open door the member site sees,
check that a package rewrite changes the next quote and not a campaign already
running, and prove that a key which is not a dial cannot be smuggled in through
the algorithm desk.
"""

from datetime import timedelta
from decimal import Decimal

from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.common.config import PACKAGE_CATALOG
from apps.common.testutils import make_user
from apps.marketplace.models import Listing
from apps.moderation.models import AuditLog, Report
from apps.notifications.models import Notification
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.wallet.models import Transaction, Wallet

from . import promotions
from .models import AdminSetting, PromoReview, StaffAccount
from .tests_staff import RbacTestCase

QUEUE_URL = '/api/admin/promotions/'
PACKAGES_URL = '/api/admin/promotions/packages/'
ALGORITHM_URL = '/api/admin/promotions/algorithm/'
CONFIG_URL = '/api/promotions/config/'

# 900 coins over a 30-day run, 20 days of it still unspent.
BUDGET = Decimal('900.00')
UNRUN = Decimal('600')


class PromoTestCase(RbacTestCase):
    """The Client's seat, one author, and a campaign already paying for reach on their post."""

    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)
        self.desk = self.session('client_owner')
        self.author = self.member
        self.subject = Post.objects.create(author=self.author, text='a reel of the new studio')
        self.campaign = self.running()

    def running(self, owner=None, target=None, kind='post', budget='900.00', ran=10, left=20,
                status=Promotion.Status.ACTIVE, package='pk_prime', **extra):
        """A timed campaign, stamped backwards so a decision mid-run has days left to refund.

        `starts_at` comes along with the run: these rows were bought under the rule
        where approval is what takes the coins, so a refund here is measured against
        a paid-for run, not against an order still sitting in the queue.
        """
        promo = Promotion.objects.create(
            owner=owner or self.author, target_type=kind,
            target_id=str((target if target is not None else self.subject).pk),
            budget=Decimal(budget), package=package, status=status, **extra,
        )
        now = timezone.now()
        stamp = {'created_at': now - timedelta(days=ran)}
        if status not in (Promotion.Status.PENDING, Promotion.Status.DRAFT):
            stamp['starts_at'] = now - timedelta(days=ran)
        if left is not None:
            stamp['ends_at'] = now + timedelta(days=left)
        Promotion.objects.filter(pk=promo.pk).update(**stamp)
        promo.refresh_from_db()
        return promo

    def listing_of(self, seller=None):
        return Listing.objects.create(seller=seller or self.author, title='secondhand bicycle for sale',
                                      price=Decimal('1500.00'))

    def another_post(self, text='a second caption'):
        return Post.objects.create(author=self.author, text=text)

    def reported(self, target, kind='post', reason='spam', reporter=None, details='looked wrong to me'):
        return Report.objects.create(
            reporter=reporter or make_user(), target_type=kind,
            target_id=str(target.pk), reason=reason, details=details, status=Report.Status.OPEN,
        )

    def balance(self, who=None):
        wallet, _ = Wallet.objects.get_or_create(user=who or self.author)
        wallet.refresh_from_db()
        return wallet.balance

    def decide(self, promo, action, **body):
        return self.desk.post(f'{QUEUE_URL}{promo.pk}/{action}/', body, format='json')


class QueueTests(PromoTestCase):
    def test_the_queue_opens_on_campaigns_no_seat_has_signed_off_and_says_what_is_reserved(self):
        out = self.desk.get(QUEUE_URL)
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['state'], 'waiting')
        self.assertEqual([row['id'] for row in out.data['results']], [self.campaign.pk])
        self.assertEqual(out.data['counts']['waiting'], 1)
        self.assertEqual(out.data['counts']['live'], 0)
        self.assertEqual(out.data['counts']['reserved'], str(BUDGET))
        self.assertTrue(out.data['can_review'])

    def test_approving_moves_a_campaign_from_the_waiting_pile_into_the_live_one(self):
        self.desk.post(f'{QUEUE_URL}{self.campaign.pk}/approve/', {}, format='json')
        self.assertEqual(self.desk.get(f'{QUEUE_URL}?state=waiting').data['results'], [])
        live = self.desk.get(f'{QUEUE_URL}?state=live').data
        self.assertEqual([row['id'] for row in live['results']], [self.campaign.pk])
        self.assertEqual(live['counts']['waiting'], 0)
        self.assertEqual(live['counts']['live'], 1)

    def test_a_decision_on_paid_reach_is_made_looking_at_the_thing_it_sells(self):
        self.reported(self.subject, reason='misleading')
        self.reported(self.subject, reason='spam', reporter=self.admin)
        row = self.desk.get(QUEUE_URL).data['results'][0]
        self.assertEqual(row['card']['text'], 'a reel of the new studio')
        self.assertEqual(row['card']['author']['username'], self.author.username)
        self.assertEqual(row['target']['state'], self.subject.status)
        self.assertEqual(row['pile']['reports'], 2)
        self.assertEqual(row['pile']['reporters'], 2)
        self.assertEqual(row['package']['id'], 'pk_prime')
        self.assertEqual(row['package']['coins'], 800)

    def test_the_reports_under_a_campaign_arrive_as_quotable_rows_and_not_only_a_count(self):
        """`pile.reports == 2` is a number; the sentence is what an appeal is written from.

        A seat that refuses paid reach has to be able to say which report its
        decision answered, so the detail door keeps the id and the person's own
        words beside the reason, rather than a tally and nothing to quote.
        """
        first = self.reported(self.subject, reason='misleading', details='the photos are from another site')
        row = self.desk.get(f'{QUEUE_URL}{self.campaign.pk}/').data['reports'][0]
        self.assertEqual(row['id'], first.pk)
        self.assertEqual(row['details'], 'the photos are from another site')
        self.assertEqual(row['reason'], 'misleading')
        self.assertEqual(row['status'], Report.Status.OPEN)
        self.assertTrue(row['reporter']['username'])

    def test_a_listing_campaign_previews_the_listing_rather_than_a_post(self):
        bike = self.listing_of()
        promo = self.running(target=bike, kind='listing', left=None)
        row = self.desk.get(f'{QUEUE_URL}?state=all').data['results']
        found = [item for item in row if item['id'] == promo.pk][0]
        self.assertEqual(found['target']['type'], 'listing')
        self.assertEqual(found['card']['kind'], 'listing')
        self.assertEqual(found['target']['text'], 'secondhand bicycle for sale')

    def test_a_campaign_pointing_at_content_that_no_longer_exists_says_gone(self):
        promo = self.running(left=None)
        Post.objects.filter(pk=self.subject.pk).delete()
        row = self.desk.get(f'{QUEUE_URL}{promo.pk}/').data
        self.assertEqual(row['target_state'], 'gone')
        self.assertIsNone(row['campaign']['card'])
        self.assertEqual(row['campaign']['target']['state'], 'gone')

    def test_the_desk_finds_a_campaign_by_payer_by_target_and_by_the_package_bought(self):
        other = self.running(target=self.another_post(), package='pk_starter', budget='100.00')
        for query, want in ((self.author.username, [self.campaign.pk, other.pk]),
                            (str(self.subject.pk), [self.campaign.pk]),
                            ('pk_starter', [other.pk])):
            found = self.desk.get(f'{QUEUE_URL}?state=all&q={query}').data['results']
            self.assertEqual(sorted(row['id'] for row in found), sorted(want), query)

    def test_a_state_that_is_not_one_of_the_piles_is_refused_with_the_piles_named(self):
        out = self.desk.get(f'{QUEUE_URL}?state=urgent')
        self.assertEqual(out.status_code, 400)
        self.assertIn('waiting', out.data['detail'])
        self.assertIn('paused', out.data['detail'])

    def test_one_campaign_page_carries_every_decision_it_has_ever_had(self):
        self.decide(self.campaign, 'approve')
        self.decide(self.campaign, 'pause', reason='the studio footage is not theirs')
        self.decide(self.campaign, 'resume')
        detail = self.desk.get(f'{QUEUE_URL}{self.campaign.pk}/').data
        self.assertEqual([ask['action'] for ask in detail['reviews']],
                          ['approve', 'pause', 'resume'], 'the paper is oldest first')
        self.assertEqual(detail['reviews'][1]['by'], 'client_owner')
        self.assertEqual(detail['reviews'][1]['reason'], 'the studio footage is not theirs')
        self.assertEqual(detail['campaign']['sign_off'], 'resume')


class MoneyTests(PromoTestCase):
    def test_approving_signed_reach_charges_nobody_a_second_time(self):
        out = self.decide(self.campaign, 'approve')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['refunded'], '0')
        self.assertEqual(Transaction.objects.count(), 0, 'approval is not a payment')
        self.assertEqual(self.balance(), Decimal(0))
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.status, Promotion.Status.ACTIVE)
        self.assertEqual(PromoReview.objects.filter(action='approve').count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        approved = mail.outbox[0]
        self.assertEqual(approved.to, [self.author.email])
        self.assertIn('promotion', approved.subject.lower())
        self.assertIn('approved', approved.body.lower())
        self.assertIn(str(self.campaign.pk), approved.body)
        self.assertIn('#E40104', approved.alternatives[0].content)

    def test_other_campaign_decisions_do_not_send_an_approval_email(self):
        self.assertEqual(self.decide(self.campaign, 'resume').status_code, 400)
        self.assertEqual(self.decide(self.campaign, 'pause', reason='review pending').status_code, 200)
        self.assertEqual(self.decide(self.campaign, 'resume').status_code, 200)
        self.assertEqual(self.decide(self.campaign, 'reject', reason='not approved').status_code, 200)
        another = self.running(target=self.another_post())
        self.assertEqual(self.decide(another, 'stop', reason='policy issue', refund='credit').status_code, 200)
        self.assertEqual(len(mail.outbox), 4, 'every decision the desk makes is answered by letter')
        self.assertFalse([sent for sent in mail.outbox if 'approved' in sent.subject.lower()],
                         'nothing that did not pass review arrives as an approval')

    def test_a_refusal_needs_the_sentence_the_payer_is_sent(self):
        out = self.decide(self.campaign, 'reject', reason='  ')
        self.assertEqual(out.status_code, 400)
        self.assertIn('Say why', out.data['detail'])
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.status, Promotion.Status.ACTIVE)

    def test_refusing_a_campaign_gives_back_the_part_of_the_run_it_never_had(self):
        out = self.decide(self.campaign, 'reject',
                          reason='the footage in this promotion is not the seller’s')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(Decimal(out.data['refunded']), UNRUN)
        self.assertEqual(self.balance(), UNRUN)
        entry = Transaction.objects.get()
        self.assertEqual(entry.kind, Transaction.Kind.CREDIT)
        self.assertIn('Refund: campaign', entry.note)
        self.assertIn('client_owner', entry.note)
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.status, Promotion.Status.REJECTED)

    def test_refusing_a_campaign_bought_as_an_open_run_gives_back_the_whole_budget(self):
        open_ended = self.running(left=None)
        row = self.desk.get(f'{QUEUE_URL}{open_ended.pk}/').data['campaign']
        self.assertEqual(Decimal(row['refund_reject']), BUDGET,
                         'nothing ran, so nothing was earned')
        out = self.decide(open_ended, 'reject', reason='this account is already suspended')
        self.assertEqual(Decimal(out.data['refunded']), BUDGET)

    def test_a_stop_can_choose_to_hold_the_money_back_when_the_reason_is_a_broken_rule(self):
        out = self.decide(self.campaign, 'stop',
                          reason='repeatedly promoting hidden content', refund='withhold')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['refunded'], '0')
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(self.balance(), Decimal(0))
        entry = PromoReview.objects.get(action='stop')
        self.assertEqual(entry.choice, PromoReview.Choice.WITHHOLD)
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.status, Promotion.Status.ENDED)

    def test_a_stop_that_refunds_gives_back_only_the_days_the_payer_never_got(self):
        out = self.decide(self.campaign, 'stop', reason='the bank payment behind this is reversed',
                          refund='credit')
        self.assertEqual(Decimal(out.data['refunded']), UNRUN)
        self.assertEqual(self.balance(), UNRUN)
        self.assertEqual(PromoReview.objects.get(action='stop').choice, PromoReview.Choice.CREDIT)

    def test_a_stop_without_a_choice_written_is_refused_rather_than_defaulting_to_someones_loss(self):
        out = self.desk.post(f'{QUEUE_URL}{self.campaign.pk}/stop/',
                             {'reason': 'the account behind this is frozen'}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertIn('refunded or withheld', out.data['detail'])

    def test_a_stop_on_an_open_run_owes_nothing_and_says_so_instead_of_inventing_a_number(self):
        open_ended = self.running(left=None)
        row = self.desk.get(f'{QUEUE_URL}{open_ended.pk}/').data['campaign']
        self.assertEqual(Decimal(row['refund_stop']), Decimal(0))
        out = self.decide(open_ended, 'stop', reason='the promotion breaks a policy term',
                          refund='credit')
        self.assertEqual(Decimal(out.data['refunded']), Decimal(0))
        self.assertEqual(self.balance(), Decimal(0))

    def test_pausing_holds_the_money_and_the_end_date_still_runs_out(self):
        paused = self.decide(self.campaign, 'pause', reason='waiting on the appeal in the report pile')
        self.assertEqual(paused.status_code, 200)
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.status, Promotion.Status.PAUSED)
        self.assertEqual(Transaction.objects.count(), 0, 'a pause is not a refund')

        resumed = self.decide(self.campaign, 'resume')
        self.assertEqual(resumed.status_code, 200)
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.status, Promotion.Status.ACTIVE)

    def test_only_a_running_campaign_is_paused_and_only_a_paused_one_is_resumed(self):
        self.assertEqual(self.decide(self.campaign, 'resume').status_code, 400)
        self.decide(self.campaign, 'pause', reason='review pending')
        self.assertEqual(self.decide(self.campaign, 'pause', reason='again').status_code, 400)

    def test_approving_or_resuming_a_campaign_whose_run_is_over_is_refused(self):
        stale = self.running(left=-2)
        out = self.decide(stale, 'approve')
        self.assertEqual(out.status_code, 409)
        self.assertIn('run is over', out.data['detail'])
        self.assertEqual(stale.status, Promotion.Status.ACTIVE, 'a refusal changes nothing')

        paused = self.running(status=Promotion.Status.PAUSED, left=-1)
        self.assertEqual(self.decide(paused, 'resume').status_code, 409)

    def test_a_draft_has_never_been_paid_for_so_there_is_nothing_to_approve(self):
        draft = self.running(status=Promotion.Status.DRAFT)
        out = self.decide(draft, 'approve')
        self.assertEqual(out.status_code, 400)
        self.assertIn('not been ordered', out.data['detail'])

    def test_an_ended_campaign_refuses_every_verb_and_cannot_be_refunded_twice(self):
        self.decide(self.campaign, 'reject', reason='the seller is suspended')
        self.assertEqual(self.balance(), UNRUN)
        for action in ('approve', 'pause', 'resume', 'reject', 'stop'):
            out = self.decide(self.campaign, action, reason='again', refund='credit')
            self.assertEqual(out.status_code, 409, action)
        self.assertEqual(self.balance(), UNRUN)
        self.assertEqual(Transaction.objects.count(), 1, 'one refund, ever')

    def test_an_unknown_verb_is_refused_rather_than_treated_as_an_approval(self):
        out = self.decide(self.campaign, 'refund')
        self.assertEqual(out.status_code, 400)
        self.assertEqual(PromoReview.objects.count(), 0)

    def test_no_campaign_at_all_answers_404_rather_than_a_blank_decision(self):
        self.assertEqual(self.desk.get(f'{QUEUE_URL}999999/').status_code, 404)
        self.assertEqual(self.desk.post(f'{QUEUE_URL}999999/approve/', {}, format='json').status_code, 404)

    def test_the_payer_is_told_the_same_sentence_the_row_carries_and_the_audit_log_keeps_the_seat(self):
        out = self.decide(self.campaign, 'reject', reason='the reel is not theirs to promote')
        self.assertEqual(out.status_code, 200)
        note = Notification.objects.filter(recipient=self.author, kind='promotion').last()
        self.assertIn('the reel is not theirs to promote', note.text)
        row = AuditLog.objects.get(target=f'promotion:{self.campaign.pk}')
        self.assertEqual(row.action, 'promo_reject')
        self.assertIn('the reel is not theirs to promote', row.detail)


class PackageTests(PromoTestCase):
    def test_the_desk_shows_the_catalog_the_site_shipped_with_until_somebody_edits_it(self):
        out = self.desk.get(PACKAGES_URL)
        self.assertEqual(out.status_code, 200)
        self.assertTrue(out.data['is_edited'] is False)
        self.assertEqual([pack['id'] for pack in out.data['packages']],
                          [pack['id'] for pack in PACKAGE_CATALOG])
        starter = out.data['packages'][0]
        self.assertEqual(starter['coins'], 100)
        self.assertEqual(starter['days'], 3)
        self.assertEqual(starter['reach_max'], 3000, 'the reach sentence becomes a number the desk can edit')

    def test_a_package_rewritten_here_is_what_the_next_payer_is_quoted_and_not_what_was_already_bought(self):
        body = {'packages': [
            {'id': 'pk_starter', 'name': 'Starter', 'coins': 150, 'days': 4, 'reach_max': 5000},
            {'id': 'pk_growth', 'name': 'Growth', 'coins': 400, 'days': 7, 'reach_max': 12000},
            {'id': 'pk_prime', 'name': 'Prime', 'coins': 1200, 'days': 21, 'reach_max': 60000},
        ]}
        out = self.desk.post(PACKAGES_URL, body, format='json')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['packages'][0]['coins'], 150)
        self.assertEqual(self.desk.get(CONFIG_URL).data['packages'][0]['coins'], 150)
        self.assertEqual(self.desk.get(CONFIG_URL).data['packages_edited'], True)

        row = self.desk.get(f'{QUEUE_URL}{self.campaign.pk}/').data['campaign']
        self.assertEqual(row['package']['coins'], 1200, 'the price the desk quotes now')
        self.assertEqual(row['coins'], str(BUDGET), 'the coins the payer actually spent')
        self.assertEqual(PromoReview.objects.count(), 0, 'rewriting a catalog decides nothing')

    def test_a_package_that_cannot_be_bought_is_refused_with_a_sentence_for_each_one(self):
        bad = self.desk.post(PACKAGES_URL, {'packages': [
            {'id': 'pk_x', 'name': '', 'coins': 100, 'days': 3, 'reach_max': 1000},
            {'id': 'pk_y', 'name': 'Free reach', 'coins': 0, 'days': 3, 'reach_max': 1000},
            {'id': 'pk_z', 'name': 'Forever', 'coins': 100, 'days': 0, 'reach_max': 1000},
        ]}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(len(bad.data['errors']), 3)
        self.assertIn('name', bad.data['errors'][0])

        twice = self.desk.post(PACKAGES_URL, {'packages': [
            {'id': 'pk_a', 'name': 'One', 'coins': 100, 'days': 3, 'reach_max': 1000},
            {'id': 'pk_a', 'name': 'Two', 'coins': 200, 'days': 5, 'reach_max': 2000},
        ]}, format='json')
        self.assertEqual(twice.status_code, 400)
        self.assertIn('share one id', twice.data['detail'])

        empty = self.desk.post(PACKAGES_URL, {'packages': []}, format='json')
        self.assertEqual(empty.status_code, 400)
        self.assertIn('at least one package', empty.data['detail'])
        self.assertEqual(self.desk.get(PACKAGES_URL).data['is_edited'], False,
                         'a refused write left the catalog alone')

    def test_a_catalog_row_that_stopped_being_json_falls_back_to_what_the_site_shipped(self):
        self.desk.post(PACKAGES_URL, {'packages': [
            {'id': 'pk_starter', 'name': 'Starter', 'coins': 150, 'days': 4, 'reach_max': 5000},
        ]}, format='json')
        AdminSetting.objects.filter(key='promo_packages').update(value='not json any more')
        self.assertEqual([pack['id'] for pack in promotions.packages()],
                          [pack['id'] for pack in PACKAGE_CATALOG])
        self.assertEqual(self.desk.get(CONFIG_URL).status_code, 200)

    def test_a_campaign_bought_before_the_catalog_existed_still_shows_what_was_spent_on_it(self):
        odd = self.running(package='week', budget='450.00', left=None)
        row = self.desk.get(f'{QUEUE_URL}{odd.pk}/').data['campaign']
        self.assertEqual(row['package']['name'], 'week')
        self.assertEqual(row['package']['coins'], 450)


class AlgorithmTests(PromoTestCase):
    def test_the_dials_the_contract_names_are_all_on_one_desk(self):
        out = self.desk.get(ALGORITHM_URL)
        self.assertEqual(out.status_code, 200)
        self.assertEqual(sorted(out.data['weights']),
                         ['algo_weight_comment', 'algo_weight_follow', 'algo_weight_like',
                          'algo_weight_save', 'algo_weight_watch'])
        self.assertEqual(sorted(out.data['caps']), ['daily', 'gap', 'repeat'])
        self.assertIs(out.data['global_pause'], False)
        self.assertEqual(out.data['running'], 1)
        self.assertEqual([line['key'] for line in out.data['lines']].count('promo_packages'), 0,
                         'the packages have their own desk')

    def test_a_dial_turned_here_is_what_the_open_door_reports_next(self):
        out = self.desk.post(ALGORITHM_URL, {
            'algo_weight_like': '7', 'algo_relevance_floor': '3',
            'promo_daily_cap': '5', 'promo_repeat_limit': '2', 'promo_organic_gap': '6',
            'promo_global_pause': '1',
        }, format='json')
        self.assertEqual(out.status_code, 200)
        self.assertIn('pause every promotion', out.data['detail'].lower())
        self.assertEqual(len(out.data['changed']), 6)
        public = self.desk.get(CONFIG_URL).data
        self.assertEqual(public['weights']['algo_weight_like'], 7)
        self.assertEqual(public['floor'], 3)
        self.assertEqual(public['caps'], {'daily': 5, 'repeat': 2, 'gap': 6})
        self.assertIs(public['global_pause'], True)

    def test_the_desk_writes_only_the_dials_that_were_actually_turned(self):
        self.desk.post(ALGORITHM_URL, {'algo_weight_like': '9'}, format='json')
        row = AuditLog.objects.get(target='promotion reach controls')
        self.assertEqual(row.detail.count(','), 0, 'one dial moved, so one dial is named')
        self.assertIn('like', row.detail.lower())

    def test_a_number_that_is_not_a_dial_value_is_refused_rather_than_saved_as_zero(self):
        for key, value in (('algo_weight_like', 'heavy'), ('promo_daily_cap', '-4'),
                           ('algo_relevance_floor', '99999')):
            out = self.desk.post(ALGORITHM_URL, {key: value}, format='json')
            self.assertEqual(out.status_code, 400, key)
        self.assertEqual(self.desk.get(CONFIG_URL).data['weights']['algo_weight_like'], 3)

    def test_saving_a_desk_that_has_not_been_touched_is_refused_not_logged_twice(self):
        out = self.desk.post(ALGORITHM_URL, {'note': 'looked at it'}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertIn('no dial', out.data['detail'])

    def test_a_key_that_is_not_a_dial_cannot_be_smuggled_through_the_algorithm_desk(self):
        """The desk is least-privilege on purpose.

        `coin_price` and `user_actions` are real settings keys on real doors. A POST
        that could reach through this desk to them would turn a reach tuning box into
        a way to change what a Coin costs without the pricing key or its audit row.
        """
        out = self.desk.post(ALGORITHM_URL, {'coin_price': '1', 'user_actions': '1'}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertEqual(out.data['detail'], 'Nothing to save — no dial has been turned.')
        self.assertEqual(AdminSetting.objects.filter(key='coin_price').count(), 0)

    def test_the_packages_cannot_be_edited_from_the_algorithm_desk_either(self):
        self.assertEqual(self.desk.post(ALGORITHM_URL, {'promo_packages': '[]'}, format='json').status_code, 400)

    def test_the_switch_that_stops_selling_reach_is_read_by_the_site_without_a_seat(self):
        self.assertEqual(self.desk.get(CONFIG_URL).data['global_pause'], False)
        self.desk.post(ALGORITHM_URL, {'promo_global_pause': 'on'}, format='json')
        self.assertIs(self.desk.get(CONFIG_URL).data['global_pause'], True)
        queue = self.desk.get(QUEUE_URL).data
        self.assertIs(queue['controls']['global_pause'], True,
                      'the desk warns the person reading the queue that nothing is being delivered')


class SeatTests(PromoTestCase):
    def grant(self, *keys):
        seat = self.seat(self.mod)
        seat.granted_keys = list(keys)
        seat.save(update_fields=['granted_keys'])
        return self.session('night_mod')

    def test_a_moderator_without_the_reach_keys_is_refused_every_door_naming_the_first_one(self):
        mod = self.session('night_mod')
        for url in (QUEUE_URL, PACKAGES_URL, ALGORITHM_URL):
            self.assertEqual(mod.get(url).status_code, 403, url)
        self.assertEqual(mod.get(QUEUE_URL).data['permission'], 'promotions_view')

    def test_an_admin_holds_all_four_promotion_doors_because_the_contract_says_so(self):
        desk = self.session('desk_admin')
        for url in (QUEUE_URL, PACKAGES_URL, ALGORITHM_URL):
            self.assertEqual(desk.get(url).status_code, 200, url)
        self.assertEqual(desk.post(f'{QUEUE_URL}{self.campaign.pk}/approve/', {}, format='json').status_code, 200)

    def test_a_seat_that_may_read_the_queue_but_must_not_decide_is_told_so_on_the_row(self):
        mod = self.grant('promotions_view')
        page = mod.get(QUEUE_URL)
        self.assertEqual(page.status_code, 200)
        self.assertFalse(page.data['can_review'], 'the screen is told, not left to guess')
        refused = mod.post(f'{QUEUE_URL}{self.campaign.pk}/reject/', {'reason': 'no'}, format='json')
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['permission'], 'promotions_review')
        self.campaign.refresh_from_db()
        self.assertEqual(self.campaign.status, Promotion.Status.ACTIVE)
        self.assertEqual(self.balance(), Decimal(0), 'a refused verb moved no coins')

    def test_the_cashier_of_the_queue_does_not_get_the_packages_or_the_dials(self):
        mod = self.grant('promotions_view', 'promotions_review')
        self.assertEqual(mod.get(PACKAGES_URL).status_code, 403)
        out = mod.get(ALGORITHM_URL)
        self.assertEqual(out.status_code, 403)
        self.assertEqual(out.data['permission'], 'promotion_algorithm')

    def test_the_open_door_needs_no_seat_because_a_feed_cannot_rank_against_a_threshold_it_cannot_read(self):
        stranger = APIClient()
        out = stranger.get(CONFIG_URL)
        self.assertEqual(out.status_code, 200)
        self.assertEqual(sorted(out.data['weights']), sorted(promotions.WEIGHTS))
