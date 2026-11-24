"""Put the paid campaigns the 6.8 walkthrough decides on where it expects them.

The promotion desk is judged on money, so the seed gives every verb something
distinct to do: a campaign no seat has looked at yet and nothing reported against
it (approve), a second one nobody has looked at but three people have already
complained about (refuse, with the sentence a refund is quoted from), one already
signed off and running (pause, then stop with a refund), one paused (resume, then
stop with the money withheld), one ended with a decision on the row (the paper
trail), one whose paid run has already run out (the approval that must be refused),
one still a draft (nothing was ever paid, so there is nothing to approve) and one
pointing at a listing rather than a post, because reach is sold in the marketplace
too.

The dates are whole days on purpose. A refusal hands back the part of the run the
payer never got, counted to the second, so a walkthrough that expects a round
number has to be given a span that divides: 300 coins over 30 days with 18 to run
is 180 back, 800 over 16 with 12 left is 600, and the drift between seeding and
clicking is microseconds.

Like the coin seed, this file resets only its own accounts. It never deletes a
ledger row — the wallet table refuses deletes — so the payers here go back to a
balance of zero and the run is judged on the refund it can still see. The
payers live on their own domain for the same reason the coin payers do: the
directory section counts `example.test` accounts and a page holds ten.

    backend/.venv/Scripts/python.exe admin/qa/promotions_seed.py
"""

import os
import sys
from datetime import timedelta
from decimal import Decimal

import django

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
sys.path.insert(0, BACKEND)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')
django.setup()

from django.utils import timezone  # noqa: E402

from apps.accounts.models import User  # noqa: E402
from apps.adminpanel.models import PromoReview  # noqa: E402
from apps.marketplace.models import Listing  # noqa: E402
from apps.moderation.models import Report  # noqa: E402
from apps.posts.models import Post  # noqa: E402
from apps.promotions.models import Promotion  # noqa: E402
from apps.wallet.models import Wallet  # noqa: E402

PASSWORD = 'exposing-demo-1'
MAIL = 'reach.test'
MARK = 'console QA sample - promotion desk'
OWNER = 'sita'

WAITING = 'qa_promo_one'
LIVE = 'qa_promo_two'
PAUSED = 'qa_promo_three'
ENDED = 'qa_promo_four'
FIVE = 'qa_promo_five'
STALE = 'qa_promo_stale'
DRAFT = 'qa_promo_draft'
# An order in the queue that no seat has touched: no coins taken, no run started.
ORDER = 'qa_promo_order'
Payers = (WAITING, LIVE, PAUSED, ENDED, FIVE, STALE, DRAFT, ORDER)


def account(username):
    """A payer, back to its start state whichever verbs the last run used."""
    user = User.objects.filter(username=username).first()
    if user is None:
        user = User.objects.create_user(username=username, password=PASSWORD, email=f'{username}@{MAIL}')
    user.email = f'{username}@{MAIL}'
    user.is_active = True
    user.suspended_until = None
    user.save()
    profile = getattr(user, 'profile', None)
    if profile is not None:
        profile.display_name = profile.display_name or username.replace('qa_promo_', 'QA Promo ')
        profile.save(update_fields=['display_name'])
    Wallet.objects.get_or_create(user=user)
    return user


def caption(user, text):
    """Something for the campaign to sell, with the author the desk will read."""
    return Post.objects.create(author=user, text=text)


def for_sale(user, title):
    return Listing.objects.create(seller=user, title=title, price=Decimal('24000.00'))


def campaign(owner, target, kind, package, budget, ran, left, status, **extra):
    """A campaign stamped backwards, so its run has an age and days left to refund."""
    promo = Promotion.objects.create(
        owner=owner, target_type=kind, target_id=str(target.pk), budget=Decimal(budget),
        package=package, status=status, **extra,
    )
    now = timezone.now()
    stamp = {'created_at': now - timedelta(days=ran)}
    if status not in (Promotion.Status.PENDING, Promotion.Status.DRAFT):
        # A row that is already running was paid for, and approval is what takes the
        # coins — so it carries the start date the migration gives the old ones.
        stamp['starts_at'] = now - timedelta(days=ran)
    if left is not None:
        stamp['ends_at'] = now + timedelta(days=left)
    Promotion.objects.filter(pk=promo.pk).update(**stamp)
    promo.refresh_from_db()
    return promo


def decided(promo, actor, action, reason='', refunded='0', choice=''):
    """A decision the last run of the site never made — the paper the desk reads."""
    entry = PromoReview.objects.create(
        promotion=promo, actor=actor, action=action, reason=reason,
        coins_refunded=Decimal(refunded), choice=choice,
    )
    return entry


def reported(target, kind, reason, reporter, status=Report.Status.OPEN, details=''):
    return Report.objects.create(
        reporter=reporter, target_type=kind, target_id=str(target.pk), reason=reason,
        status=status, details=details,
    )


def main():
    users = {name: account(name) for name in Payers}
    actor = User.objects.filter(username=OWNER).first() or users[WAITING]
    strangers = [account(f'qa_promo_witness_{index}') for index in (1, 2)]

    # Every campaign and review this file owns goes back to nothing first: the
    # walkthrough approves, refuses, pauses and stops, and a second run has to see
    # the same five states it was written against.
    mine = Promotion.objects.filter(owner__in=users.values())
    PromoReview.objects.filter(promotion__in=mine).delete()
    mine.delete()
    Report.objects.filter(target_type__in=('post', 'listing'),
                          target_id__in=list(Post.objects.filter(author__in=users.values())
                                             .values_list('pk', flat=True))
                          + list(Listing.objects.filter(seller__in=users.values())
                                 .values_list('pk', flat=True))).delete()
    Post.objects.filter(author__in=users.values()).delete()
    Listing.objects.filter(seller__in=users.values()).delete()
    # Refunds are real ledger rows and the ledger refuses deletes, so the run is
    # judged from a zeroed purse rather than from whatever the last one left.
    Wallet.objects.filter(user__in=users.values()).update(balance=Decimal('0.00'))

    one = caption(users[WAITING], f'{MARK} the reel we paid to push — a studio tour in Kathmandu')
    two = for_sale(users[LIVE], f'{MARK} a bicycle listed for coins')
    three = caption(users[PAUSED], f'{MARK} a campaign the platform paused')
    four = caption(users[ENDED], f'{MARK} a campaign that was stopped')
    five = caption(users[FIVE], f'{MARK} a clean campaign with nothing reported on it')
    stale = caption(users[STALE], f'{MARK} a run that finished before anyone looked')
    draft = caption(users[DRAFT], f'{MARK} a draft nobody has paid for')
    ordered = caption(users[ORDER], f'{MARK} a campaign bought and waiting for a seat')

    # 300 coins over 30 days, 18 of them still to run: refusing it owes 180 back.
    waiting = campaign(users[WAITING], one, 'post', 'pk_growth', '300.00', 12, 18,
                       Promotion.Status.ACTIVE, category='Photography',
                       age_min=18, age_max=35, country='Nepal', cities=['Kathmandu'])
    # 800 coins over 16 days with 12 left, so a stop refunds 600 — and the desk has
    # to be told whether it will, because withholding is also an answer.
    live = campaign(users[LIVE], two, 'listing', 'pk_prime', '800.00', 4, 12,
                    Promotion.Status.ACTIVE, category='Vehicles', country='Nepal')
    paused = campaign(users[PAUSED], three, 'post', 'pk_starter', '120.00', 8, 4,
                      Promotion.Status.PAUSED, category='Music')
    ended = campaign(users[ENDED], four, 'post', 'pk_starter', '100.00', 40, None,
                     Promotion.Status.ENDED)
    # 600 coins over 30 days, 12 still to run, and nothing against it: the one
    # approval that is only ever supposed to change a status, not a balance.
    clean = campaign(users[FIVE], five, 'post', 'pk_prime', '600.00', 18, 12,
                     Promotion.Status.ACTIVE, category='Photography',
                     age_min=25, age_max=44, country='Nepal')
    campaign(users[STALE], stale, 'post', 'pk_growth', '150.00', 20, -2, Promotion.Status.ACTIVE)
    campaign(users[DRAFT], draft, 'post', 'pk_starter', '100.00', 1, None,
             Promotion.Status.DRAFT)
    # The new money rule, on one row: ordered, aimed at two named cities, 300 coins
    # still sitting in the payer's wallet and no end date until a seat approves it.
    pending = campaign(users[ORDER], ordered, 'post', 'pk_growth', '300.00', 0, None,
                       Promotion.Status.PENDING, category='Photography',
                       age_min=18, age_max=45, country='Nepal',
                       cities=['Kathmandu', 'Bhaktapur'])
    Wallet.objects.filter(user=users[ORDER]).update(balance=Decimal('300.00'))

    decided(live, actor, PromoReview.Action.APPROVE, reason='', refunded='0')
    # A stop that withheld is the one decision that honestly owes nothing back, so
    # the seeded paper trail needs no invented ledger row behind it.
    decided(ended, actor, PromoReview.Action.STOP,
            reason=f'{MARK} the account kept breaking the same policy term',
            refunded='0', choice=PromoReview.Choice.WITHHOLD)
    # Resumed campaigns are the paper a dispute is settled from: one row for the
    # pause the desk will undo, so the trail is a trail and not a single verdict.
    decided(paused, actor, PromoReview.Action.PAUSE,
            reason=f'{MARK} held while the photos were checked', refunded='0')

    # The waiting campaign is not clean: three people have already reported the
    # post, which is exactly the sentence the desk has to read before approving.
    reported(one, 'post', 'misleading', strangers[0],
             details='the tour in this reel is the same footage another account posted first')
    reported(one, 'post', 'spam', strangers[1],
             details='posted the same link in four comments under different posts')
    reported(one, 'post', 'spam', users[LIVE], status=Report.Status.DISMISSED,
             details='looked wrong to me')
    reported(two, 'listing', 'scam', strangers[0], details='the bicycle was never delivered')

    print(f'{FIVE} is a clean campaign nobody has signed off: #{clean.pk}')
    print(f'{WAITING} holds a campaign nobody has signed off, with 2 open reports under it: #{waiting.pk}')
    print(f'{LIVE} is running and already approved: #{live.pk} | {PAUSED} is paused: #{paused.pk}')
    print(f'{ENDED} was stopped with the money withheld: #{ended.pk} | {STALE} ran out: past its end date')
    print(f'{ORDER} ordered reach and has paid nothing: #{pending.pk} — 300 coins still in their wallet')
    print('re-run any time: these eight accounts and their campaigns are reset to these states.')


if __name__ == '__main__':
    main()
