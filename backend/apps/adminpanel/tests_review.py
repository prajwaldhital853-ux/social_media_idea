"""Contract 6.3: what a decision does — to the pile, the content, the money and the person.

A review queue is only as good as the rules under it, so these tests read it the
way a moderator does (one target, six reporters, one campaign running on it) and
then check what the five verbs actually move: the status column, every open
report on that target, whatever promotion was paying for reach on it, the
sentence that lands in the author's bell and the row in the shared audit log.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.common.testutils import auth_client, make_user
from apps.comments.models import Comment
from apps.marketplace.models import Listing
from apps.moderation.models import AuditLog, Report
from apps.notifications.models import Notification
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.wallet.models import Transaction, Wallet

from . import policy, review
from .models import PolicyCategory, PolicyTerm, PublicNotice, StaffAccount
from .tests_staff import RbacTestCase

QUEUE_URL = '/api/admin/review/'
SHELF_URL = '/api/admin/content/'
POLICY_URL = '/api/admin/policy/'
TERMS_URL = '/api/admin/policy/terms/'
CATEGORIES_URL = '/api/admin/policy/categories/'
NOTICES_URL = '/api/admin/notices/'
ATTACH_URL = '/api/admin/notices/attach/'

OPEN = Report.Status.OPEN
RESOLVED = Report.Status.RESOLVED
DISMISSED = Report.Status.DISMISSED


class ReviewTestCase(RbacTestCase):
    """The three seats from 6.1 plus the content a queue can hold something for."""

    def setUp(self):
        super().setUp()
        StaffAccount.objects.create(user=self.admin, role=StaffAccount.Role.ADMIN)
        StaffAccount.objects.create(user=self.mod, role=StaffAccount.Role.MODERATOR)

    def post_of(self, author=None, text='an ordinary caption', **extra):
        return Post.objects.create(author=author or self.member, text=text, **extra)

    def listing_of(self, seller=None, title='secondhand bicycle for sale', **extra):
        extra.setdefault('price', Decimal('1500.00'))
        return Listing.objects.create(seller=seller or self.member, title=title, **extra)

    def reported(self, target, kind='post', reason='spam', status=OPEN, reporter=None):
        return Report.objects.create(
            reporter=reporter or make_user(), target_type=kind,
            target_id=str(target.pk), reason=reason, status=status,
        )

    def pile_on(self, target, kind='post', reasons=('spam', 'spam', 'harassment'), status=OPEN):
        """The same target reported by several people — the pile one decision clears."""
        return [self.reported(target, kind, reason=reason, status=status) for reason in reasons]

    def campaign(self, owner, target, kind='post', budget='900.00', ran=10, left=20,
                 status=Promotion.Status.ACTIVE, package='week'):
        """A timed campaign, stamped backwards so a stop mid-run has days left to refund."""
        promo = Promotion.objects.create(
            owner=owner, target_type=kind, target_id=str(target.pk),
            budget=Decimal(budget), package=package, status=status,
        )
        now = timezone.now()
        stamp = {'created_at': now - timedelta(days=ran)}
        if left is not None:
            stamp['ends_at'] = now + timedelta(days=left)
        Promotion.objects.filter(pk=promo.pk).update(**stamp)
        promo.refresh_from_db()
        return promo

    def purse(self, user, amount):
        """The wallet signup already made for this person, topped up to a known balance."""
        wallet, _ = Wallet.objects.get_or_create(user=user)
        Wallet.objects.filter(pk=wallet.pk).update(balance=Decimal(amount))
        wallet.refresh_from_db()
        return wallet


class QueueTests(ReviewTestCase):
    def test_one_row_carries_the_report_the_content_and_the_whole_pile(self):
        post = self.post_of(text='a caption nobody asked for')
        rows = self.pile_on(post)
        self.pile_on(post, reasons=('spam',), status=DISMISSED)

        page = self.session('night_mod').get(QUEUE_URL)
        self.assertEqual(page.status_code, 200)
        self.assertEqual(len(page.data['results']), 3, 'the queue holds open reports, not the closed ones')

        row = next(item for item in page.data['results'] if item['id'] == rows[0].pk)
        self.assertEqual(row['target'], f'post:{post.pk}')
        self.assertEqual(row['content']['id'], post.pk)
        self.assertEqual(row['content']['state'], 'live')
        self.assertEqual(row['content']['author']['username'], 'ordinary')
        self.assertEqual(row['permission'], 'content')
        self.assertIn('remove', row['actions'])
        self.assertEqual(row['pile'], {
            'reports': 4, 'open': 3, 'reporters': 3,
            'reasons': [{'reason': 'spam', 'n': 2}, {'reason': 'harassment', 'n': 1}],
        })

        facets = page.data['facets']
        self.assertEqual(facets['open'], 3)
        self.assertEqual(facets['by_target'], {'post': 3, 'comment': 0, 'listing': 0, 'user': 0})
        self.assertEqual(facets['auto_hide_at'], settings.EXPOSING_REPORT_THRESHOLD)

    def test_the_queue_filters_by_what_was_reported_and_by_who_reported_it(self):
        listing = self.listing_of()
        self.reported(self.post_of())
        mine = self.reported(listing, kind='listing', reason='counterfeit')

        desk = self.session('night_mod')
        shelf = desk.get(QUEUE_URL, {'target': 'listing'})
        self.assertEqual([row['target_type'] for row in shelf.data['results']], ['listing'])
        self.assertEqual(shelf.data['facets']['open'], 2, 'facets count the queue, not the filter')

        searched = desk.get(QUEUE_URL, {'q': 'counterfeit'})
        self.assertEqual([row['id'] for row in searched.data['results']], [mine.pk])
        self.assertEqual(desk.get(QUEUE_URL, {'target': 'shop'}).status_code, 400)
        self.assertEqual(desk.get(QUEUE_URL, {'status': 'someday'}).status_code, 400)

        closed = desk.get(QUEUE_URL, {'status': 'resolved'})
        self.assertEqual(closed.data['results'], [])

    def test_a_report_about_content_that_has_since_vanished_is_named_not_crashed(self):
        doomed = self.post_of(text='a caption soon deleted')
        report = self.reported(doomed)
        doomed.delete()

        row = self.session('night_mod').get(QUEUE_URL).data['results'][0]
        self.assertEqual(row['id'], report.pk)
        self.assertTrue(row['missing'])
        self.assertIsNone(row['content'])
        self.assertEqual(row['actions'], [], 'no verb can act on a target that is not there')
        self.assertEqual(row['pile']['open'], 1)

    def test_the_queue_marks_the_text_against_the_words_the_platform_banned(self):
        PolicyTerm.objects.create(kind=PolicyTerm.Kind.WORD, text='fake id')
        PolicyTerm.objects.create(kind=PolicyTerm.Kind.WORD, text='knuckle duster', is_active=False)
        post = self.post_of(text='Selling a FAKE   ID here, no duster')
        self.reported(post)

        row = self.session('night_mod').get(QUEUE_URL).data['results'][0]
        self.assertEqual(row['matches'], ['fake id'])

    def test_the_queue_says_a_reported_post_is_being_paid_for(self):
        post = self.post_of()
        self.campaign(self.member, post)
        self.reported(post)

        row = self.session('night_mod').get(QUEUE_URL).data['results'][0]
        self.assertEqual(row['campaigns'], 1)

    def test_a_seat_without_the_report_key_is_told_which_screen_it_cannot_open(self):
        seat = self.seat(self.mod)
        seat.denied_keys = ['reports']
        seat.save(update_fields=['denied_keys'])

        response = self.session('night_mod').get(QUEUE_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['permission'], 'reports')
        self.assertEqual(response.data['label'], 'Report queue')

    def test_the_queue_is_not_a_public_endpoint(self):
        for client in (APIClient(), auth_client(self.member)):
            self.assertIn(client.get(QUEUE_URL).status_code, (401, 403))


class DecideTests(ReviewTestCase):
    def test_dismissing_one_report_closes_every_open_report_on_the_target(self):
        post = self.post_of()
        rows = self.pile_on(post)
        desk = self.session('night_mod')

        out = desk.post(f'{QUEUE_URL}{rows[0].pk}/decide/', {'action': 'dismiss'}, format='json')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['reports_closed'], 3)
        self.assertEqual(out.data['pile']['open'], 0)
        self.assertEqual(out.data['facets']['open'], 0)

        post.refresh_from_db()
        self.assertEqual(post.status, Post.Status.LIVE)
        closed = Report.objects.filter(status=DISMISSED)
        self.assertEqual(closed.count(), 3)
        self.assertTrue(all(row.resolved_at for row in closed), 'a closed report says when it closed')
        self.assertFalse(Notification.objects.exists(), 'dismissing is not a message to the author')

        entry = AuditLog.objects.get(action='dismiss_reports')
        self.assertEqual(entry.actor, self.mod)
        self.assertEqual(entry.target, f'post:{post.pk}')
        self.assertIn('dismissed', entry.detail)

    def test_removing_needs_a_reason_and_that_reason_is_what_the_author_reads(self):
        post = self.post_of(text='a caption that crossed the line')
        rows = self.pile_on(post, reasons=('harassment', 'harassment'))
        desk = self.session('night_mod')

        bare = desk.post(f'{QUEUE_URL}{rows[0].pk}/decide/', {'action': 'remove'}, format='json')
        self.assertEqual(bare.status_code, 400)
        self.assertIn('Say why', bare.data['detail'])
        post.refresh_from_db()
        self.assertEqual(post.status, Post.Status.LIVE, 'a refused decision moves nothing')
        self.assertFalse(AuditLog.objects.filter(action__in=set(review.AUDIT.values())).exists())

        out = desk.post(f'{QUEUE_URL}{rows[0].pk}/decide/',
                        {'action': 'remove', 'reason': 'repeated harassment of another member'}, format='json')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['reports_closed'], 2)
        self.assertEqual(out.data['content']['state'], 'removed', 'the row re-renders as it now stands')

        post.refresh_from_db()
        self.assertEqual(post.status, Post.Status.REMOVED)

        note = Notification.objects.get(recipient=self.member, kind='warning')
        self.assertIn('repeated harassment of another member', note.text)
        self.assertEqual(note.target_type, 'post')
        self.assertEqual(note.target_id, str(post.pk))
        self.assertEqual(note.actor, self.mod)

        self.assertEqual(Report.objects.filter(status=RESOLVED).count(), 2)
        self.assertEqual(AuditLog.objects.get(action='remove_content').detail,
                         'repeated harassment of another member')

    def test_removing_a_second_time_moves_nothing_and_notifies_once(self):
        post = self.post_of()
        rows = self.pile_on(post, reasons=('spam', 'spam'))
        desk = self.session('night_mod')
        self.assertEqual(
            desk.post(f'{QUEUE_URL}{rows[0].pk}/decide/', {'action': 'remove', 'reason': 'spam'},
                      format='json').status_code, 200)

        again = desk.post(f'{QUEUE_URL}{rows[1].pk}/decide/',
                          {'action': 'remove', 'reason': 'spam again'}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertIn('already taken down', again.data['detail'])
        self.assertEqual(Notification.objects.filter(kind='warning').count(), 1)
        self.assertEqual(AuditLog.objects.filter(action='remove_content').count(), 1)

    def test_an_account_is_not_taken_down_or_reinstated_from_the_report_queue(self):
        report = self.reported(self.member, kind='user', reason='impersonation')
        desk = self.session('night_mod')

        takedown = desk.post(f'{QUEUE_URL}{report.pk}/decide/',
                             {'action': 'remove', 'reason': 'a fake profile'}, format='json')
        self.assertEqual(takedown.status_code, 400)
        self.assertIn('suspend it from People', takedown.data['detail'])

        held = desk.post(f'{QUEUE_URL}{report.pk}/decide/', {'action': 'release'}, format='json')
        self.assertEqual(held.status_code, 400)
        self.assertIn('it is suspended or it is not', held.data['detail'])

        back = desk.post(f'{QUEUE_URL}{report.pk}/decide/', {'action': 'restore'}, format='json')
        self.assertEqual(back.status_code, 400)
        self.assertIn('reinstated from People', back.data['detail'])

        report.refresh_from_db()
        self.assertEqual(report.status, OPEN, 'a refused verb leaves the report in the queue')

    def test_a_listing_decision_needs_the_marketplace_key_not_only_the_queue(self):
        listing = self.listing_of()
        report = self.reported(listing, kind='listing')
        seat = self.seat(self.mod)
        seat.denied_keys = ['listings']
        seat.save(update_fields=['denied_keys'])

        out = self.session('night_mod').post(
            f'{QUEUE_URL}{report.pk}/decide/', {'action': 'remove', 'reason': 'stolen goods'}, format='json')
        self.assertEqual(out.status_code, 403)
        self.assertEqual(out.data['permission'], 'listings')
        self.assertEqual(out.data['label'], 'Marketplace listing review')

        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.Status.ACTIVE)
        report.refresh_from_db()
        self.assertEqual(report.status, OPEN)

    def test_a_seat_hired_for_the_marketplace_does_not_get_the_feed(self):
        seat = self.seat(self.mod)
        seat.denied_keys = ['content']
        seat.save(update_fields=['denied_keys'])
        post = self.post_of()
        listing = self.listing_of()
        desk = self.session('night_mod')

        self.assertEqual(desk.get(QUEUE_URL).status_code, 200, 'reading the queue is the reports key')
        refused = desk.post(f'{QUEUE_URL}{self.reported(post).pk}/decide/',
                            {'action': 'remove', 'reason': 'spam'}, format='json')
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['permission'], 'content')
        post.refresh_from_db()
        self.assertEqual(post.status, Post.Status.LIVE)

        allowed = desk.post(f'{QUEUE_URL}{self.reported(listing, kind="listing").pk}/decide/',
                            {'action': 'dismiss'}, format='json')
        self.assertEqual(allowed.status_code, 200)

    def test_warning_leaves_the_content_up_and_puts_a_sentence_on_it(self):
        post = self.post_of()
        report = self.reported(post, reason='spam')
        desk = self.session('night_mod')

        blank = desk.post(f'{QUEUE_URL}{report.pk}/decide/', {'action': 'warn'}, format='json')
        self.assertEqual(blank.status_code, 400)
        self.assertIn('the community is shown', blank.data['detail'])

        out = desk.post(f'{QUEUE_URL}{report.pk}/decide/', {
            'action': 'warn', 'reason': 'first strike',
            'notice': 'This account has been warned for spam.',
        }, format='json')
        self.assertEqual(out.status_code, 200)

        notice = PublicNotice.objects.get()
        self.assertEqual(notice.target_type, 'post')
        self.assertEqual(notice.target_id, str(post.pk))
        self.assertEqual(notice.about, self.member)
        self.assertEqual(notice.actor, self.mod)
        self.assertEqual(notice.reason, 'first strike')
        self.assertTrue(notice.is_live)
        self.assertEqual(out.data['notice']['id'], notice.pk)

        post.refresh_from_db()
        self.assertEqual(post.status, Post.Status.LIVE, 'a warning is not a takedown')
        self.assertEqual(Report.objects.filter(status=RESOLVED).count(), 1)
        self.assertIn('public warning notice', Notification.objects.get(recipient=self.member).text)
        self.assertEqual(AuditLog.objects.get(action='public_notice').target, f'post:{post.pk}')

    def test_releasing_an_autohidden_post_clears_the_pile_that_hidd_it(self):
        post = self.post_of(status=Post.Status.HIDDEN)
        rows = self.pile_on(post)
        desk = self.session('night_mod')

        out = desk.post(f'{QUEUE_URL}{rows[0].pk}/decide/', {'action': 'release'}, format='json')
        self.assertEqual(out.status_code, 200)
        post.refresh_from_db()
        self.assertEqual(post.status, Post.Status.LIVE)
        self.assertEqual(out.data['reports_closed'], 3)
        self.assertIn('back in the feed', Notification.objects.get(recipient=self.member).text)

        still_up = self.post_of()
        held = desk.post(f'{QUEUE_URL}{self.reported(still_up).pk}/decide/', {'action': 'release'}, format='json')
        self.assertEqual(held.status_code, 400)
        self.assertIn('hidden pending review', held.data['detail'])
        self.assertEqual(Notification.objects.count(), 1, 'the refused release sent nothing')

    def test_a_listing_is_never_held_pending_review(self):
        listing = self.listing_of()
        report = self.reported(listing, kind='listing')

        out = self.session('night_mod').post(
            f'{QUEUE_URL}{report.pk}/decide/', {'action': 'release'}, format='json')
        self.assertEqual(out.status_code, 400)
        self.assertIn('it is up, or it is taken down', out.data['detail'])
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.Status.ACTIVE)

    def test_only_the_five_verbs_and_only_a_report_that_exists(self):
        report = self.reported(self.post_of())
        desk = self.session('night_mod')

        bad = desk.post(f'{QUEUE_URL}{report.pk}/decide/', {'action': 'delete'}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.data['detail'], 'Choose dismiss, remove, warn, release or restore.')
        self.assertEqual(desk.post(f'{QUEUE_URL}999999/decide/', {'action': 'dismiss'}, format='json').status_code, 404)
        report.refresh_from_db()
        self.assertEqual(report.status, OPEN)


class CampaignMoneyTests(ReviewTestCase):
    def test_removing_content_stops_its_campaign_and_hands_back_the_days_it_never_ran(self):
        post = self.post_of()
        report = self.reported(post)
        wallet = self.purse(self.member, '900.00')
        promo = self.campaign(self.member, post, budget='900.00', ran=10, left=20)
        desk = self.session('night_mod')

        out = desk.post(f'{QUEUE_URL}{report.pk}/decide/',
                        {'action': 'remove', 'reason': 'banned product'}, format='json')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data['refunded'], '600')
        self.assertEqual(out.data['campaigns'][0]['id'], promo.pk)
        self.assertEqual(out.data['campaigns'][0]['refunded'], '600')
        self.assertEqual(out.data['campaigns'][0]['owner'], 'ordinary')
        self.assertIn('1 campaign(s) cancelled', out.data['detail'])
        self.assertIn('600 coins refunded', out.data['detail'])
        # The audit row keeps the reason the author was shown, not the arithmetic.
        self.assertEqual(AuditLog.objects.get(action='remove_content').detail, 'banned product')

        promo.refresh_from_db()
        self.assertEqual(promo.status, Promotion.Status.ENDED)
        self.assertLess(abs(promo.ends_at - timezone.now()), timedelta(seconds=60))

        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal('1500.00'))
        entry = Transaction.objects.get(wallet=wallet)
        self.assertEqual(entry.kind, Transaction.Kind.CREDIT)
        self.assertEqual(entry.amount, Decimal('600.00'))
        self.assertTrue(entry.note.startswith('Refund: campaign'))
        self.assertIn(f'moderation removed post:{post.pk}', entry.note)

    def test_a_campaign_bought_as_an_open_run_stops_but_refunds_nothing(self):
        listing = self.listing_of()
        report = self.reported(listing, kind='listing')
        wallet = self.purse(self.member, '500.00')
        promo = self.campaign(self.member, listing, kind='listing', budget='500.00', ran=4, left=None)
        desk = self.session('night_mod')

        out = desk.post(f'{QUEUE_URL}{report.pk}/decide/',
                        {'action': 'remove', 'reason': 'counterfeit goods'}, format='json')
        self.assertEqual(out.data['refunded'], '0')
        self.assertEqual(out.data['campaigns'][0]['refunded'], '0')
        self.assertNotIn('refunded', out.data['detail'])

        promo.refresh_from_db()
        self.assertEqual(promo.status, Promotion.Status.ENDED)
        self.assertLess(abs(promo.ends_at - timezone.now()), timedelta(seconds=60),
                        'stopping an open run gives it the end date it now has')
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal('500.00'))
        self.assertFalse(Transaction.objects.filter(wallet=wallet).exists())

    def test_only_the_campaigns_running_on_that_content_stop(self):
        post = self.post_of()
        other = self.post_of()
        running = self.campaign(self.member, post, budget='300.00', ran=5, left=5)
        paused = self.campaign(self.member, post, budget='200.00', ran=10, left=10,
                               status=Promotion.Status.PAUSED)
        elsewhere = self.campaign(self.member, other, budget='100.00', ran=1, left=9)
        finished = self.campaign(self.member, post, budget='50.00', status=Promotion.Status.ENDED)
        desk = self.session('night_mod')

        out = desk.post(f'{QUEUE_URL}{self.reported(post).pk}/decide/',
                        {'action': 'remove', 'reason': 'spam'}, format='json')
        self.assertEqual({row['id'] for row in out.data['campaigns']}, {running.pk, paused.pk})
        self.assertEqual(out.data['refunded'], '250', '150 of the 300 plus 100 of the 200')

        for promo, status in ((running, 'ended'), (paused, 'ended'),
                              (elsewhere, 'active'), (finished, 'ended')):
            promo.refresh_from_db()
            self.assertEqual(promo.status, status)

    def test_content_taken_down_again_after_a_restore_does_not_pay_out_twice(self):
        post = self.post_of()
        report = self.reported(post)
        wallet = self.purse(self.member, '900.00')
        self.campaign(self.member, post, budget='900.00', ran=10, left=20)
        desk = self.session('night_mod')

        first = desk.post(f'{QUEUE_URL}{report.pk}/decide/', {'action': 'remove', 'reason': 'spam'}, format='json')
        self.assertEqual(first.data['refunded'], '600')

        back = desk.post(f'{SHELF_URL}post/{post.pk}/', {'action': 'restore'}, format='json')
        self.assertEqual(back.status_code, 200)
        again = desk.post(f'{SHELF_URL}post/{post.pk}/', {'action': 'remove', 'reason': 'spam again'}, format='json')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.data['campaigns'], [], 'the ended campaign is not a second payday')
        self.assertEqual(again.data['refunded'], '0')

        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal('1500.00'))


class ShelfTests(ReviewTestCase):
    def test_the_shelf_lists_what_is_down_with_the_sentence_that_took_it_down(self):
        down = self.post_of(text='a caption that was taken down')
        self.post_of(text='a caption still in the feed')
        review.act('post', down.pk, self.mod, 'remove', reason='hate speech')

        page = self.session('night_mod').get(SHELF_URL, {'type': 'post', 'state': 'removed'})
        self.assertEqual(page.status_code, 200)
        self.assertEqual([row['content']['id'] for row in page.data['results']], [down.pk])

        row = page.data['results'][0]
        self.assertEqual(row['target'], f'post:{down.pk}')
        self.assertEqual(row['decision']['action'], 'remove_content')
        self.assertEqual(row['decision']['actor'], 'night_mod')
        self.assertEqual(row['decision']['detail'], 'hate speech')
        self.assertEqual(row['actions'], ['restore', 'warn'])
        self.assertEqual(page.data['counts'], {'live': 1, 'removed': 1})
        self.assertEqual(page.data['type'], 'post')

    def test_taken_down_covers_both_halves_of_the_off_feed_state(self):
        hidden = self.post_of(status=Post.Status.HIDDEN)
        removed = self.post_of(status=Post.Status.REMOVED)
        live = self.post_of()
        desk = self.session('night_mod')

        both = {row['content']['id'] for row in desk.get(SHELF_URL).data['results']}
        self.assertEqual(both, {hidden.pk, removed.pk})
        self.assertEqual({row['content']['id'] for row in desk.get(SHELF_URL, {'state': 'hidden'}).data['results']},
                         {hidden.pk})
        self.assertEqual({row['content']['id'] for row in desk.get(SHELF_URL, {'state': 'live'}).data['results']},
                         {live.pk})
        self.assertEqual(len(desk.get(SHELF_URL, {'state': 'all'}).data['results']), 3)

    def test_a_post_can_be_restored_long_after_its_reports_closed(self):
        post = self.post_of()
        report = self.reported(post)
        desk = self.session('night_mod')
        desk.post(f'{QUEUE_URL}{report.pk}/decide/', {'action': 'dismiss'}, format='json')
        # The pile is gone, but the auto-hide rule had already pulled the post out.
        Post.objects.filter(pk=post.pk).update(status=Post.Status.REMOVED)

        out = desk.post(f'{SHELF_URL}post/{post.pk}/', {'action': 'restore'}, format='json')
        self.assertEqual(out.status_code, 200)
        post.refresh_from_db()
        self.assertEqual(post.status, Post.Status.LIVE)
        self.assertEqual(out.data['reports_closed'], 0)

        note = Notification.objects.get(recipient=self.member, kind='warning')
        self.assertIn('restored', note.text)
        self.assertEqual(AuditLog.objects.get(action='restore_content').actor, self.mod)

    def test_the_shelf_refuses_a_verb_the_content_is_not_standing_in(self):
        live = self.post_of()
        desk = self.session('night_mod')

        refused = desk.post(f'{SHELF_URL}post/{live.pk}/', {'action': 'restore'}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertIn('Only something already taken down', refused.data['detail'])
        self.assertEqual(desk.post(f'{SHELF_URL}user/{self.member.pk}/', {'action': 'restore'},
                                   format='json').status_code, 400)
        self.assertEqual(desk.post(f'{SHELF_URL}post/999999/', {'action': 'restore'},
                                   format='json').status_code, 400)
        self.assertFalse(AuditLog.objects.filter(action__in=set(review.AUDIT.values())).exists())

    def test_the_shelf_searches_the_caption_and_the_author(self):
        kept = self.post_of(text='a caption about gardening')
        hit = self.post_of(author=make_user('rita'), text='a caption about boats')
        desk = self.session('night_mod')

        page = desk.get(SHELF_URL, {'state': 'all', 'q': 'rita'})
        self.assertEqual([row['content']['id'] for row in page.data['results']], [hit.pk])
        self.assertEqual(desk.get(SHELF_URL, {'type': 'shop'}).status_code, 400)
        self.assertEqual(desk.get(SHELF_URL, {'state': 'gone'}).status_code, 400)
        self.assertNotIn(kept.pk, [row['content']['id'] for row in page.data['results']])

    def test_removed_comments_are_listed_with_the_post_they_sit_on(self):
        PolicyTerm.objects.create(kind=PolicyTerm.Kind.WORD, text='fake id')
        post = self.post_of(text='the caption being argued under')
        comment = Comment.objects.create(post=post, author=self.member, text='an answer about a FAKE   ID')
        review.act('comment', comment.pk, self.mod, 'remove', reason='abuse')

        row = self.session('night_mod').get(SHELF_URL, {'type': 'comment'}).data['results'][0]
        self.assertEqual(row['target'], f'comment:{comment.pk}')
        self.assertEqual(row['content']['on_post']['id'], post.pk)
        self.assertEqual(row['content']['on_post']['state'], 'live')
        self.assertEqual(row['matches'], ['fake id'])
        self.assertEqual(row['permission'], 'content')

    def test_a_seat_without_the_marketplace_key_cannot_open_the_listing_shelf(self):
        seat = self.seat(self.mod)
        seat.denied_keys = ['listings']
        seat.save(update_fields=['denied_keys'])

        response = self.session('night_mod').get(SHELF_URL, {'type': 'listing'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['permission'], 'listings')


class PolicyTests(ReviewTestCase):
    def test_the_policy_screen_shows_the_words_the_shelf_labels_and_the_autohide_number(self):
        PolicyTerm.objects.create(kind=PolicyTerm.Kind.WORD, text='counterfeit')
        PolicyTerm.objects.create(kind=PolicyTerm.Kind.ITEM, text='firearms', note='weapons policy')
        PolicyCategory.objects.create(name='Electronics', sort_order=10)
        for _ in range(2):
            self.listing_of(category='Electronics')
        self.listing_of(category='electronics')
        self.listing_of(category='Electronics', status=Listing.Status.REMOVED)

        page = self.session('desk_admin').get(POLICY_URL)
        self.assertEqual(page.status_code, 200)
        # Ordering is (kind, text), so the prohibited items lead the blocked words.
        self.assertEqual([(row['kind'], row['text']) for row in page.data['terms']],
                         [('item', 'firearms'), ('word', 'counterfeit')])
        self.assertEqual(page.data['terms'][0]['note'], 'weapons policy')
        self.assertEqual(page.data['terms'][0]['created_by'], None)
        self.assertEqual(page.data['auto_hide_at'], settings.EXPOSING_REPORT_THRESHOLD)
        self.assertEqual(page.data['categories'][0]['listings'], 3, 'the label spelled two ways counts as one shelf')

    def test_a_blocked_word_is_stored_in_one_case_and_refuses_a_second_copy(self):
        admin = self.session('desk_admin')
        added = admin.post(TERMS_URL, {'kind': 'word', 'text': '  Gun   POWDER '}, format='json')
        self.assertEqual(added.status_code, 201)
        self.assertEqual(added.data['text'], 'gun powder')
        self.assertEqual(added.data['created_by'], 'desk_admin')
        self.assertTrue(added.data['is_active'])

        twice = admin.post(TERMS_URL, {'kind': 'word', 'text': 'gun    powder'}, format='json')
        self.assertEqual(twice.status_code, 400)
        self.assertIn('already on that list', twice.data['detail'])
        self.assertEqual(PolicyTerm.objects.count(), 1)

        # The same text is a different kind of rule, so it is allowed to exist twice.
        self.assertEqual(admin.post(TERMS_URL, {'kind': 'item', 'text': 'gun powder'},
                                    format='json').status_code, 201)
        self.assertEqual(admin.post(TERMS_URL, {'kind': 'word', 'text': 'x' * 81}, format='json').status_code, 400)
        self.assertEqual(admin.post(TERMS_URL, {'kind': 'spell', 'text': 'abc'}, format='json').status_code, 400)
        self.assertEqual(admin.post(TERMS_URL, {'kind': 'word', 'text': '   '}, format='json').status_code, 400)

        entry = AuditLog.objects.get(action='policy_term', target='word:gun powder')
        self.assertEqual(entry.detail, 'added to the list')
        self.assertEqual(entry.actor, self.admin)

    def test_an_entry_can_be_renamed_switched_off_or_taken_off_the_list(self):
        admin = self.session('desk_admin')
        kept = admin.post(TERMS_URL, {'kind': 'word', 'text': 'fake id'}, format='json').data
        other = admin.post(TERMS_URL, {'kind': 'word', 'text': 'knock off'}, format='json').data

        renamed = admin.post(f'{TERMS_URL}{kept["id"]}/', {'text': 'forged id'}, format='json')
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.data['text'], 'forged id')

        clash = admin.post(f'{TERMS_URL}{kept["id"]}/', {'text': 'knock off'}, format='json')
        self.assertEqual(clash.status_code, 400)
        self.assertEqual(admin.post(f'{TERMS_URL}{other["id"]}/', {}, format='json').status_code, 400)
        self.assertEqual(admin.post(f'{TERMS_URL}999999/', {'text': 'anything'}, format='json').status_code, 404)

        off = admin.post(f'{TERMS_URL}{other["id"]}/', {'is_active': False}, format='json')
        self.assertFalse(off.data['is_active'])

        gone = admin.delete(f'{TERMS_URL}{kept["id"]}/')
        self.assertEqual(gone.status_code, 200)
        self.assertEqual(gone.data['text'], 'forged id')
        self.assertFalse(PolicyTerm.objects.filter(pk=kept['id']).exists())
        self.assertTrue(AuditLog.objects.filter(action='policy_term', detail='removed from the list').exists())

    def test_reading_the_list_is_every_moderators_job_but_writing_it_is_not(self):
        mod = self.session('night_mod')
        self.assertEqual(mod.get(POLICY_URL).status_code, 200)

        words = mod.post(TERMS_URL, {'kind': 'word', 'text': 'firearm'}, format='json')
        self.assertEqual(words.status_code, 403)
        self.assertEqual(words.data['permission'], 'blocked_words')
        self.assertEqual(words.data['label'], 'Prohibited items and blocked words')

        shelves = mod.post(CATEGORIES_URL, {'name': 'Weapons'}, format='json')
        self.assertEqual(shelves.status_code, 403)
        self.assertEqual(shelves.data['permission'], 'categories')
        self.assertFalse(PolicyTerm.objects.exists())
        self.assertFalse(PolicyCategory.objects.exists())

    def test_new_shelf_labels_queue_up_after_the_ones_already_in_use(self):
        admin = self.session('desk_admin')
        first = admin.post(CATEGORIES_URL, {'name': '  Used   Vehicles '}, format='json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data['name'], 'Used Vehicles')
        self.assertEqual(first.data['sort_order'], 10)
        self.assertEqual(admin.post(CATEGORIES_URL, {'name': 'used vehicles'}, format='json').status_code, 400)
        self.assertEqual(admin.post(CATEGORIES_URL, {'name': '   '}, format='json').status_code, 400)

        second = admin.post(CATEGORIES_URL, {'name': 'Electronics'}, format='json')
        self.assertEqual(second.data['sort_order'], 20, 'a new label lands at the end of the shelf')

        moved = admin.post(f'{CATEGORIES_URL}{second.data["id"]}/', {'sort_order': 5}, format='json')
        self.assertEqual(moved.data['sort_order'], 5)
        self.assertEqual(admin.post(f'{CATEGORIES_URL}{second.data["id"]}/', {'sort_order': 'soon'},
                                    format='json').status_code, 400)

        page = admin.get(POLICY_URL)
        self.assertEqual([row['name'] for row in page.data['categories']],
                         ['Electronics', 'Used Vehicles'])

        hidden = admin.post(f'{CATEGORIES_URL}{second.data["id"]}/', {'is_active': False}, format='json')
        self.assertFalse(hidden.data['is_active'])
        self.assertEqual(policy.category_names(), ['Used Vehicles'])
        self.assertEqual(policy.category_names(active_only=False), ['Electronics', 'Used Vehicles'])

        gone = admin.delete(f'{CATEGORIES_URL}{second.data["id"]}/')
        self.assertEqual(gone.status_code, 200)
        self.assertEqual(gone.data['name'], 'Electronics')
        self.assertFalse(PolicyCategory.objects.filter(pk=second.data['id']).exists())
        self.assertEqual(admin.delete(f'{CATEGORIES_URL}999999/').status_code, 404)

    def test_switching_a_word_off_stops_it_marking_the_queue(self):
        post = self.post_of(text='a FAKE   ID for sale')
        self.reported(post)
        term = PolicyTerm.objects.create(kind=PolicyTerm.Kind.WORD, text='fake id')
        desk = self.session('night_mod')

        self.assertEqual(desk.get(QUEUE_URL).data['results'][0]['matches'], ['fake id'])
        PolicyTerm.objects.filter(pk=term.pk).update(is_active=False)
        self.assertEqual(desk.get(QUEUE_URL).data['results'][0]['matches'], [])


class NoticeTests(ReviewTestCase):
    def warned(self, desk, text='This account has been warned for spam.', reason='spam'):
        post = self.post_of()
        report = self.reported(post, reason=reason)
        out = desk.post(f'{QUEUE_URL}{report.pk}/decide/',
                        {'action': 'warn', 'reason': reason, 'notice': text}, format='json')
        self.assertEqual(out.status_code, 200)
        return post, out.data['notice']

    def warned_on(self, desk, target, kind, text):
        report = self.reported(target, kind=kind)
        out = desk.post(f'{QUEUE_URL}{report.pk}/decide/',
                        {'action': 'warn', 'reason': 'policy', 'notice': text}, format='json')
        self.assertEqual(out.status_code, 200)
        return out.data['notice']

    def test_the_notice_desk_is_the_history_of_every_public_warning(self):
        desk = self.session('night_mod')
        post, _old = self.warned(desk, 'This post broke the harassment rule.')
        listing = self.listing_of()
        self.warned_on(desk, listing, 'listing', 'This listing sold a counterfeit good.')

        page = desk.get(NOTICES_URL)
        self.assertEqual(page.status_code, 200)
        self.assertEqual(len(page.data['results']), 2)
        self.assertEqual(page.data['results'][0]['target'], f'listing:{listing.pk}', 'newest first')
        self.assertEqual({row['about'] for row in page.data['results']}, {'ordinary'})
        self.assertEqual({row['actor'] for row in page.data['results']}, {'night_mod'})
        self.assertTrue(all(row['is_live'] for row in page.data['results']))
        self.assertIsNone(page.data['results'][0]['withdrawn_at'])

        only_posts = desk.get(NOTICES_URL, {'target': 'post'})
        self.assertEqual([row['target'] for row in only_posts.data['results']], [f'post:{post.pk}'])
        searched = desk.get(NOTICES_URL, {'q': 'harassment rule'})
        self.assertEqual(len(searched.data['results']), 1)

    def test_withdrawing_a_notice_is_its_own_audited_decision(self):
        desk = self.session('night_mod')
        post, notice = self.warned(desk)

        withdrawn = desk.post(f'{NOTICES_URL}{notice["id"]}/withdraw/', {}, format='json')
        self.assertEqual(withdrawn.status_code, 200)
        self.assertFalse(withdrawn.data['is_live'])
        self.assertIsNotNone(withdrawn.data['withdrawn_at'])

        again = desk.post(f'{NOTICES_URL}{notice["id"]}/withdraw/', {}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertIn('already withdrawn', again.data['detail'])
        self.assertEqual(desk.post(f'{NOTICES_URL}999999/withdraw/', {}, format='json').status_code, 404)

        entry = AuditLog.objects.get(action='withdraw_notice')
        self.assertEqual(entry.target, f'post:{post.pk}')
        self.assertEqual(entry.detail, 'This account has been warned for spam.')
        self.assertEqual(entry.actor, self.mod)
        self.assertEqual(PublicNotice.objects.count(), 1, 'withdrawing keeps the row it explains')

    def test_the_community_can_read_what_it_was_told_about_one_post(self):
        desk = self.session('night_mod')
        post, notice = self.warned(desk, 'This post broke the spam rule.')
        untouched = self.post_of()

        open_page = APIClient().get(f'/api/notices/post/{post.pk}/')
        self.assertEqual(open_page.status_code, 200)
        self.assertEqual(open_page.data['target'], f'post:{post.pk}')
        self.assertEqual([row['id'] for row in open_page.data['notices']], [notice['id']])
        self.assertEqual(open_page.data['notices'][0]['text'], 'This post broke the spam rule.')
        self.assertEqual(APIClient().get(f'/api/notices/post/{untouched.pk}/').data['notices'], [])
        self.assertEqual(APIClient().get('/api/notices/shop/1/').status_code, 400)

        desk.post(f'{NOTICES_URL}{notice["id"]}/withdraw/', {}, format='json')
        self.assertEqual(APIClient().get(f'/api/notices/post/{post.pk}/').data['notices'], [])

    def test_a_seat_without_the_notice_key_cannot_read_the_warning_history(self):
        seat = self.seat(self.mod)
        seat.denied_keys = ['notices']
        seat.save(update_fields=['denied_keys'])

        response = self.session('night_mod').get(NOTICES_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['permission'], 'notices')

    def test_a_notice_goes_on_content_that_nobody_reported(self):
        """Contract 6.5: the dashboard is the only door, so the door has to exist."""
        desk = self.session('night_mod')
        post = self.post_of(text='this remedy cures cancer in two days')

        out = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'This claim is false.',
                                     'reason': 'misinformation'}, format='json')
        self.assertEqual(out.status_code, 201)
        self.assertEqual(out.data['notice']['target'], f'post:{post.pk}')
        self.assertEqual(out.data['notice']['about'], 'ordinary')
        self.assertEqual(out.data['notice']['actor'], 'night_mod')
        self.assertEqual(out.data['notice']['reason'], 'misinformation')
        self.assertTrue(out.data['notice']['is_live'])
        self.assertIn('standing on post', out.data['detail'])

        page = desk.get(NOTICES_URL)
        self.assertEqual([row['target'] for row in page.data['results']], [f'post:{post.pk}'])

        community = APIClient().get(f'/api/notices/post/{post.pk}/')
        self.assertEqual(community.status_code, 200)
        self.assertEqual([row['text'] for row in community.data['notices']], ['This claim is false.'],
                         'what the dashboard wrote is what the site reads')

        entry = AuditLog.objects.get(action='attach_notice')
        self.assertEqual(entry.target, f'post:{post.pk}')
        self.assertEqual(entry.actor, self.mod)
        self.assertIn('misinformation', entry.detail)
        self.assertIn('This claim is false.', entry.detail)
        self.assertEqual(Report.objects.count(), 0, 'the notice was not waiting for a report')

    def test_every_kind_of_content_takes_a_notice_the_same_way(self):
        desk = self.session('night_mod')
        comment = Comment.objects.create(post=self.post_of(), author=self.member, text='a rude reply')
        listing = self.listing_of()
        member = self.member

        for target, kind in ((f'comment:{comment.pk}', 'comment'),
                             (f'listing:{listing.pk}', 'listing'),
                             (f'user:{member.pk}', 'user')):
            out = desk.post(ATTACH_URL, {'target': target, 'text': f'A warning about {kind}.',
                                         'reason': 'policy'}, format='json')
            self.assertEqual(out.status_code, 201, target)
            self.assertEqual(out.data['notice']['target_type'], kind)

        self.assertEqual(
            {row['target'] for row in desk.get(NOTICES_URL).data['results']},
            {f'comment:{comment.pk}', f'listing:{listing.pk}', f'user:{member.pk}'})
        self.assertEqual(APIClient().get(f'/api/notices/comment/{comment.pk}/').data['notices'][0]['about'],
                         'ordinary')

    def test_a_notice_needs_both_the_sentence_and_the_reason_for_it(self):
        desk = self.session('night_mod')
        post = self.post_of()

        blank = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': '  ',
                                       'reason': 'spam'}, format='json')
        self.assertEqual(blank.status_code, 400)
        self.assertIn('sentence the community will read', blank.data['detail'])

        no_reason = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'False claim.',
                                           'reason': ''}, format='json')
        self.assertEqual(no_reason.status_code, 400)
        self.assertIn('audit row keeps', no_reason.data['detail'])

        too_long = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'x' * 241,
                                          'reason': 'spam'}, format='json')
        self.assertEqual(too_long.status_code, 400)
        self.assertIn('240', too_long.data['detail'])
        self.assertEqual(PublicNotice.objects.count(), 0)

    def test_the_target_has_to_be_content_that_is_actually_here(self):
        desk = self.session('night_mod')
        post = self.post_of()

        gone = desk.post(ATTACH_URL, {'target': 'post:999999', 'text': 'Nothing.', 'reason': 'spam'},
                         format='json')
        self.assertEqual(gone.status_code, 404)
        self.assertIn('no post 999999', gone.data['detail'])

        wrong_kind = desk.post(ATTACH_URL, {'target': 'shop:5', 'text': 'Nothing.', 'reason': 'spam'},
                               format='json')
        self.assertEqual(wrong_kind.status_code, 400)
        self.assertIn('post:17', wrong_kind.data['detail'])

        not_a_number = desk.post(ATTACH_URL, {'target': 'post:abc', 'text': 'Nothing.', 'reason': 'spam'},
                                 format='json')
        self.assertEqual(not_a_number.status_code, 400)
        self.assertIn('not an id', not_a_number.data['detail'])
        self.assertEqual(PublicNotice.objects.count(), 0)

    def test_the_same_sentence_does_not_go_up_over_the_same_content_twice(self):
        desk = self.session('night_mod')
        post = self.post_of()

        first = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'False claim.',
                                       'reason': 'misinformation'}, format='json')
        self.assertEqual(first.status_code, 201)
        twice = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'False claim.',
                                       'reason': 'misinformation'}, format='json')
        self.assertEqual(twice.status_code, 400)
        self.assertIn('already standing', twice.data['detail'])
        self.assertEqual(PublicNotice.objects.count(), 1)

        second = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'And this one is dangerous.',
                                        'reason': 'misinformation'}, format='json')
        self.assertEqual(second.status_code, 201)
        self.assertEqual(len(APIClient().get(f'/api/notices/post/{post.pk}/').data['notices']), 2)

        desk.post(f'{NOTICES_URL}{first.data["notice"]["id"]}/withdraw/', {}, format='json')
        self.assertEqual(desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'False claim.',
                                                'reason': 'misinformation'}, format='json').status_code, 201,
                         'a withdrawn sentence may be put back up')

    def test_notices_are_one_key_and_the_pen_for_the_content_is_another(self):
        seat = self.seat(self.mod)
        seat.denied_keys = ['content']
        seat.save(update_fields=['denied_keys'])
        desk = self.session('night_mod')
        post, listing = self.post_of(), self.listing_of()

        refused = desk.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'False claim.',
                                         'reason': 'misinformation'}, format='json')
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['permission'], 'content')
        self.assertEqual(refused.data['label'], 'Post and comment review')

        marketplace = desk.post(ATTACH_URL, {'target': f'listing:{listing.pk}', 'text': 'Counterfeit.',
                                             'reason': 'fraud'}, format='json')
        self.assertEqual(marketplace.status_code, 201, 'the seat still holds the listing pen')
        self.assertEqual(PublicNotice.objects.filter(target_type='post').count(), 0)

        stranger = auth_client(make_user(username='curious'))
        self.assertEqual(stranger.post(ATTACH_URL, {'target': f'post:{post.pk}', 'text': 'Hi.',
                                                    'reason': 'spam'}, format='json').status_code, 403)


class VerbTableTests(ReviewTestCase):
    """The rules the screens are built from, checked without a browser or a seat."""

    def test_a_target_only_offers_the_verbs_its_state_can_act_on(self):
        self.assertEqual(review.actions_for('user', 'active'), ['dismiss', 'warn'])
        self.assertEqual(review.actions_for('post', Post.Status.LIVE), ['dismiss', 'remove', 'warn'])
        self.assertEqual(review.actions_for('post', Post.Status.HIDDEN),
                         ['dismiss', 'remove', 'warn', 'release'])
        self.assertEqual(review.actions_for('post', Post.Status.REMOVED), ['restore', 'warn'])
        self.assertEqual(review.actions_for('listing', Listing.Status.ACTIVE), ['dismiss', 'remove', 'warn'])
        self.assertNotIn('release', review.actions_for('listing', Listing.Status.ACTIVE))

    def test_matching_is_case_insensitive_and_reads_through_the_padding(self):
        self.assertEqual(review.match('Buy  GUNPOWDER now', ['gunpowder', 'fake id']), ['gunpowder'])
        self.assertEqual(review.match('paid for buygunpowder today', ['gunpowder']), ['gunpowder'],
                         'writing around a filter is exactly what a substring match is for')
        self.assertEqual(review.match('nothing here', ['gunpowder']), [])
        self.assertEqual(review.match(None, ['gunpowder']), [])

    def test_a_target_id_is_only_used_when_it_is_still_an_id(self):
        self.assertEqual(review.pk_of('12'), 12)
        self.assertEqual(review.pk_of(' 12 '), 12)
        for junk in ('', 'post-12', 'twelve', None):
            self.assertIsNone(review.pk_of(junk))
            self.assertIsNone(review.row_for('post', junk))

    def test_an_open_run_campaign_has_earned_every_coin_it_spent(self):
        now = timezone.now()
        promo = Promotion(owner=self.member, budget=Decimal('300.00'), ends_at=None,
                          created_at=now - timedelta(days=10))
        self.assertEqual(review.unspent(promo, now), Decimal('0'))

        promo.ends_at = now + timedelta(days=10)
        self.assertEqual(review.unspent(promo, now), Decimal('150'))

        promo.ends_at = now - timedelta(days=1)
        self.assertEqual(review.unspent(promo, now), Decimal('0'), 'a campaign already past its end is owed nothing')

        promo.ends_at = now + timedelta(days=10)
        promo.budget = Decimal('0.00')
        self.assertEqual(review.unspent(promo, now), Decimal('0'))
