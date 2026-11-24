"""Contract 6.8: the campaigns the platform has to sign off on, and the dials that
decide who is shown them.

Three powers, kept apart because they cost different things. Reading the queue is
one. Approving, refusing, pausing, stopping and refunding is another, and it moves
real coins back through `wallet.apply()` — the same door every other credit uses —
never a hand-written balance. The third is the reach itself: what a package promises,
how a campaign is ranked into a feed, how often one payer may appear, and a switch
that stops the platform selling reach without ending anybody's campaign.

The site takes the coins when a campaign is created, so there is no "pending" column
on `promotions.Promotion` to wait on. The queue therefore asks a different question
of money that has already been reserved: has a seat looked at this one? A campaign
with no review row is *waiting*, whether or not the feed is already carrying it —
which is why refusing one hands the coins back, and why a stop asks the Admin whether
the unrun part of the budget is refunded or withheld.

Nothing here reaches into the member site's tables beyond what its own API does: a
status, an end date, and one append-only ledger row when money returns.
"""

import json
from decimal import Decimal

from django.db import transaction as db_atomic
from django.utils import timezone

from apps.common.config import PACKAGE_CATALOG
from apps.common.emails import queue_event_email
from apps.marketplace.models import Listing
from apps.notifications.services import notify
from apps.posts.models import Post
from apps.promotions.models import Promotion
from apps.promotions.services import people_reached
from apps.wallet.models import Transaction, Wallet, apply as coin_apply

from . import review, settings_store
from .journal import record
from .models import PromoReview

# The ranking the feed reads. Shipped as the numbers the code used to hard-code, so
# opening this desk changes nothing on the site until somebody turns a dial.
WEIGHTS = ('algo_weight_like', 'algo_weight_comment', 'algo_weight_save', 'algo_weight_watch',
           'algo_weight_follow')
ALGO_KEYS = WEIGHTS + ('promo_weight_target', 'algo_relevance_floor', 'promo_daily_cap',
                       'promo_repeat_limit', 'promo_organic_gap')
SWITCH = 'promo_global_pause'
PACKAGES = 'promo_packages'
TURNTABLES = ALGO_KEYS + (SWITCH,)

ACTION_LABELS = {
    PromoReview.Action.APPROVE: 'Approved',
    PromoReview.Action.REJECT: 'Rejected',
    PromoReview.Action.PAUSE: 'Paused',
    PromoReview.Action.RESUME: 'Resumed',
    PromoReview.Action.STOP: 'Stopped',
}
CHOICE_LABELS = {
    PromoReview.Choice.CREDIT: 'refunded',
    PromoReview.Choice.WITHHOLD: 'withheld',
}
DELIVERY = {
    Promotion.Status.DRAFT: 'a draft nobody has run',
    Promotion.Status.ACTIVE: 'running in the feed',
    Promotion.Status.PAUSED: 'paused by somebody',
    Promotion.Status.ENDED: 'ended',
}
TARGET_MODEL = {'post': Post, 'listing': Listing}
_ACTION = {
    'approve': PromoReview.Action.APPROVE,
    'reject': PromoReview.Action.REJECT,
    'pause': PromoReview.Action.PAUSE,
    'resume': PromoReview.Action.RESUME,
    'stop': PromoReview.Action.STOP,
}
_TO = {
    'approve': Promotion.Status.ACTIVE,
    'resume': Promotion.Status.ACTIVE,
    'pause': Promotion.Status.PAUSED,
    'reject': Promotion.Status.ENDED,
    'stop': Promotion.Status.ENDED,
}


def _number(value):
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return 0


def _digits(text):
    """`Up to 3,000 people` → 3000, so a sentence the site shipped with becomes a number."""
    keep = ''.join(char for char in str(text or '') if char.isdigit())
    return int(keep) if keep else 0


def _shape(pack):
    """One package in the shape this desk edits: a price, a run, a reach promise."""
    reach_max = pack.get('reach_max') if isinstance(pack, dict) else None
    reach_max = _digits(pack.get('reach')) if reach_max in (None, '') else _number(reach_max)
    out = {
        'id': str(pack.get('id') or '').strip()[:24],
        'name': str(pack.get('name') or '').strip()[:40],
        'coins': _number(pack.get('coins')),
        'days': _number(pack.get('days')),
        'reach_max': reach_max,
    }
    out['reach'] = f'Up to {out["reach_max"]:,} people' if out['reach_max'] else 'no reach promised'
    return out


def shipped():
    return [_shape(pack) for pack in PACKAGE_CATALOG]


def packages():
    """The catalog a campaign is bought from, as this desk has it right now."""
    raw = str(settings_store.get(PACKAGES) or '').strip()
    if not raw:
        return shipped()
    try:
        rows = json.loads(raw)
    except ValueError:
        # A row that stopped being JSON must not take the storefront down: fall back
        # to the shipped catalog and let the desk say which one it is showing.
        return shipped()
    if not isinstance(rows, list) or not rows:
        return shipped()
    return [_shape(item) for item in rows if isinstance(item, dict)]


def is_edited():
    return bool(str(settings_store.get(PACKAGES) or '').strip())


def package_by_id(package_id):
    for pack in packages():
        if pack['id'] == str(package_id or ''):
            return pack
    return None


def write_packages(actor, rows):
    """Replace the catalog. Returns (status, body)."""
    if not isinstance(rows, list):
        bad = ['The catalog is a list of packages.']
        return 400, {'errors': bad, 'detail': ' '.join(bad)}
    clean, bad = [], []
    for item in rows:
        pack = _shape(item if isinstance(item, dict) else {})
        if not pack['name']:
            bad.append('Every package needs a name a payer can choose.')
        elif pack['coins'] <= 0:
            bad.append(f'{pack["name"]}: a Coin price above zero, or it is not a price.')
        elif pack['days'] <= 0:
            bad.append(f'{pack["name"]}: how many days it runs has to be above zero.')
        elif any(other['id'] == pack['id'] for other in clean):
            bad.append(f'{pack["name"]}: two packages cannot share one id.')
        else:
            clean.append(pack)
    if not clean and not bad:
        bad.append('Keep at least one package, or nobody can buy reach at all.')
    if bad:
        return 400, {'errors': bad, 'detail': ' '.join(bad)}
    settings_store.write(actor, {PACKAGES: json.dumps(clean)})
    record(actor, 'promo_packages', 'promotion packages',
           'Rewrote the packages: ' + ', '.join(
               f'{pack["name"]} ({pack["coins"]} coins / {pack["days"]} d / {pack["reach"]})'
               for pack in clean) + '.')
    return 200, {
        'packages': clean,
        'detail': 'The catalog is live. A campaign already bought keeps the price it paid; these are '
                  'the numbers the next payer is quoted.',
    }


def latest(promotion_pk):
    return PromoReview.objects.filter(promotion_id=promotion_pk).order_by('-created_at', '-id').first()


def _review_row(item):
    return {
        'action': item.action,
        'label': ACTION_LABELS.get(item.action, item.action),
        'reason': item.reason,
        'coins_refunded': str(item.coins_refunded),
        'choice': CHOICE_LABELS.get(item.choice) or None,
        'by': item.actor.username if item.actor else None,
        'at': item.created_at.isoformat(),
    }


def reviews(promotion_pk):
    """Every decision on one campaign, oldest first — the paper a dispute is settled from."""
    return [_review_row(item) for item in
            PromoReview.objects.filter(promotion_id=promotion_pk).order_by('created_at', 'id')]


def sign_off(promo, last=None):
    """What a seat last said about this campaign — or that nobody has said anything."""
    last = last if last is not None else latest(promo.pk)
    if last is None:
        return 'waiting' if promo.status == Promotion.Status.ACTIVE else 'none'
    return last.action


def target_of(promo):
    """The post or listing the money is spent on, or None if it no longer exists."""
    pk = review.pk_of(promo.target_id)
    model = TARGET_MODEL.get(promo.target_type)
    if pk is None or model is None:
        return None
    who = 'author' if promo.target_type == 'post' else 'seller'
    return model.objects.filter(pk=pk).select_related(who).first()


def owed(promo, action, now=None):
    """The coins this decision would hand back, before anybody clicks it.

    A refused campaign was never signed off, so everything it reserved goes back —
    pro-rated if it had an end date and started running against it. A stopped one
    gives back only the part of its run it never got, and an open-ended campaign has
    no unrun part, so a stop there owes nothing and says so instead of inventing a
    number.
    """
    now = now or timezone.now()
    budget = Decimal(str(promo.budget or 0))
    if budget <= 0:
        return Decimal('0')
    if action == 'reject':
        return review.unspent(promo, now) if promo.ends_at else budget
    if action == 'stop':
        return review.unspent(promo, now)
    return Decimal('0')


def row(promo, last=None, deep=False):
    """One campaign as the desk sees it: who paid, what they bought, what is on it."""
    last = last if last is not None else latest(promo.pk)
    now = timezone.now()
    state = sign_off(promo, last)
    target = target_of(promo)
    pack = package_by_id(promo.package)
    out = {
        'id': promo.pk,
        'owner': promo.owner.username,
        'card': review.preview(promo.target_type, target) if deep else None,
        'target': {'type': promo.target_type, 'id': promo.target_id,
                   'state': review.state_of(promo.target_type, target) if target is not None else 'gone',
                   'text': (target.text if promo.target_type == 'post' else target.title)[:220]
                   if target is not None else ''},
        'status': promo.status,
        'status_label': promo.get_status_display(),
        'running': promo.status == Promotion.Status.ACTIVE,
        'sign_off': state,
        'sign_off_label': ACTION_LABELS.get(state) or ('Waiting on a seat' if state == 'waiting' else 'Nobody yet'),
        'delivery': DELIVERY.get(promo.status, promo.status),
        'category': promo.category,
        'targeting': {'age_min': promo.age_min, 'age_max': promo.age_max,
                      'country': promo.country, 'city': promo.city},
        'package': pack or (None if not promo.package and not promo.budget else {
            'id': promo.package, 'name': promo.package or 'bought as a budget',
            'coins': _number(promo.budget), 'days': None, 'reach': 'no package on the row',
            'reach_max': 0,
        }),
        'coins': str(promo.budget),
        'impressions': promo.impressions,
        'clicks': promo.clicks,
        # What the package promised against what the ledger has actually handed out.
        # A payer reading "up to 40,000 people" beside a campaign that reached 300 is
        # a conversation the desk should be able to have without opening a console.
        'reach_bought': (pack or {}).get('reach_max') or 0,
        'delivered': promo.impressions,
        'people': people_reached(promo.pk) if deep else None,
        'created_at': promo.created_at.isoformat(),
        'ends_at': promo.ends_at.isoformat() if promo.ends_at else None,
        'age_hours': round((now - promo.created_at).total_seconds() / 3600, 1),
        'left_hours': round((promo.ends_at - now).total_seconds() / 3600, 1) if promo.ends_at else None,
        'refund_reject': str(owed(promo, 'reject', now)),
        'refund_stop': str(owed(promo, 'stop', now)),
        'pile': review.pile(promo.target_type, promo.target_id),
        'today': Promotion.objects.filter(owner=promo.owner, created_at__date=now.date()).count(),
    }
    if last is not None:
        out['review'] = _review_row(last)
        out['took'] = str(last.created_at - promo.created_at).split('.')[0]
    return out


def _said(action, promo, refund):
    if action == 'approve':
        return (f'Campaign {promo.pk} approved and running. Nothing was charged again — the payer '
                'had already reserved it.')
    if action == 'reject':
        return (f'Campaign {promo.pk} refused. {refund} coins went back through the ledger.'
                if refund else f'Campaign {promo.pk} refused. Nothing was owed back on it.')
    if action == 'pause':
        return f'Campaign {promo.pk} is out of the feed until it is resumed. The reservation stands.'
    if action == 'resume':
        return f'Campaign {promo.pk} is running again, on the end date it already had.'
    return (f'Campaign {promo.pk} stopped. {refund} coins of the unrun part went back.'
            if refund else f'Campaign {promo.pk} stopped and nothing was refunded — the reason is on the row.')


def decide(promo, actor, action, reason='', choice=''):
    """Approve, refuse, pause, resume or stop one campaign. Returns (status, body).

    A refusal always hands the reservation back — the payer never signed up to fund
    a campaign the platform itself turned down. A stop is different: the run was
    approved and something went wrong during it, so whether the unspent days are
    refunded or kept is a decision the seat has to make out loud.
    """
    reason = str(reason or '').strip()[:240]
    choice = str(choice or '').strip()
    if action not in _ACTION:
        return 400, {'detail': 'Approve, reject, pause, resume or stop.'}
    if promo.status == Promotion.Status.ENDED:
        return 409, {'detail': 'That campaign has already ended. Nothing here changes it again.'}
    if action in ('reject', 'stop') and not reason:
        return 400, {'detail': 'Say why the money is refused — the payer is told this sentence.'
                              if action == 'reject' else
                              'Say why this paid run is ending early. The sentence goes on the record.'}
    if action == 'stop' and choice not in ('credit', 'withhold'):
        return 400, {'detail': 'Choose whether the unrun part of the budget is refunded or withheld.'}
    if action in ('approve', 'resume') and promo.ends_at and promo.ends_at <= timezone.now():
        return 409, {'detail': 'Its run is over. Approving it now would promise reach that no longer exists.'}
    if action == 'approve' and promo.status == Promotion.Status.DRAFT:
        return 400, {'detail': 'A draft has not been paid for yet — there is nothing here to approve.'}
    if action == 'pause' and promo.status != Promotion.Status.ACTIVE:
        return 400, {'detail': 'Only a campaign that is running can be paused.'}
    if action == 'resume' and promo.status != Promotion.Status.PAUSED:
        return 400, {'detail': 'That campaign is not paused.'}

    now = timezone.now()
    held = action == 'stop' and choice == 'withhold'
    refund = Decimal('0') if held or action not in ('reject', 'stop') else owed(promo, action, now)
    status = _TO[action]

    with db_atomic.atomic():
        Promotion.objects.filter(pk=promo.pk).update(
            status=status, ends_at=now if status == Promotion.Status.ENDED else promo.ends_at)
        promo.refresh_from_db()
        if refund > 0:
            wallet, _ = Wallet.objects.get_or_create(user=promo.owner)
            coin_apply(wallet.pk, Transaction.Kind.CREDIT, refund,
                       f'Refund: campaign {promo.pk} {action} by {actor.username}')
        entry = PromoReview.objects.create(
            promotion=promo, actor=actor, action=_ACTION[action], reason=reason, coins_refunded=refund,
            choice=PromoReview.Choice.CREDIT if refund > 0
            else (PromoReview.Choice.WITHHOLD if held else ''),
        )

    say = {
        'approve': f'Your campaign {promo.pk} was approved and is running.',
        'reject': f'Your campaign {promo.pk} was refused: {reason}',
        'pause': f'Your campaign {promo.pk} was paused by the platform.',
        'resume': f'Your campaign {promo.pk} is running again.',
        'stop': f'Your campaign {promo.pk} was stopped: {reason}',
    }[action]
    notify(promo.owner, actor, 'promotion', say[:240], 'promotion', promo.pk)
    record(actor, f'promo_{action}', f'promotion:{promo.pk}',
           f'{promo.target_type}:{promo.target_id} — {promo.budget} coins reserved — '
           + (reason if reason else f'{refund} coins back'))
    if action == 'approve':
        pack = package_by_id(promo.package)
        queue_event_email(
            promo.owner.email,
            f'Exposing promotion {promo.pk} approved',
            'Your promotion is approved',
            'The Exposing team has approved your promotion. It is now active and eligible to run in the feed.',
            details=[
                ('Campaign', f'#{promo.pk}'),
                ('Package', pack['name'] if pack else promo.package or 'Custom budget'),
                ('Budget', f'{promo.budget} coins'),
                ('Promoted content', promo.target_type.title()),
                ('Status', 'Approved and running'),
            ],
            cta_label='View your promotion', cta_path='/wallet/promotions',
            footnote='No additional coins were charged for this approval.',
        )
    return 200, {
        'detail': _said(action, promo, refund),
        'campaign': row(promo, entry),
        'refunded': str(refund),
        'reviews': reviews(promo.pk),
    }


def algorithm():
    """The dials the feed reads, with who last turned each one."""
    lines = [item for item in settings_store.lines_group('promo') if item['key'] != PACKAGES]
    values = {item['key']: item['value'] for item in lines}
    return {
        'lines': lines,
        'weights': {key: values[key] for key in WEIGHTS},
        'target': values['promo_weight_target'],
        'floor': values['algo_relevance_floor'],
        'caps': {'daily': values['promo_daily_cap'], 'repeat': values['promo_repeat_limit'],
                 'gap': values['promo_organic_gap']},
        'global_pause': bool(values[SWITCH]),
        'packages': packages(),
        'shipped': not is_edited(),
    }


def write_algorithm(actor, posted):
    """Turn the dials. Only what came back is written, so the audit row names the
    knobs that actually moved instead of everything the desk had open."""
    cached = settings_store.cached()
    updates, bad = {}, []
    for key, value in (posted or {}).items():
        if key not in TURNTABLES:
            continue
        spec = cached[key]
        if spec['type'] == 'bool':
            updates[key] = '1' if str(value).strip().lower() in ('1', 'true', 'yes', 'on') else ''
            continue
        if str(value).strip() == '':
            updates[key] = ''
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            bad.append(f'{spec["label"]} has to be a number.')
            continue
        if number < 0:
            bad.append(f'{spec["label"]} cannot be negative.')
            continue
        if number > 9999:
            bad.append(f'{spec["label"]} is far past any number this desk means.')
            continue
        updates[key] = str(int(number)) if spec['type'] == 'int' else str(number)
    if bad:
        return 400, {'errors': bad, 'detail': ' '.join(bad)}
    if not updates:
        return 400, {'detail': 'Nothing to save — no dial has been turned.'}
    settings_store.write(actor, updates)
    labels = [cached[key]['label'] for key in updates]
    record(actor, 'promotion_algorithm', 'promotion reach controls',
           'Changed ' + ', '.join(label.lower() for label in labels) + '.')
    return 200, {
        'detail': 'Saved ' + ', '.join(label.lower() for label in labels)
                  + '. The feed reads the new numbers on its next page.',
        'changed': list(updates),
    }


def public_config():
    """What the member site needs to honour these dials — no login, no seat."""
    tuned = algorithm()
    return {
        'weights': tuned['weights'],
        'target': tuned['target'],
        'floor': tuned['floor'],
        'caps': tuned['caps'],
        'global_pause': tuned['global_pause'],
        'packages': tuned['packages'],
        'packages_edited': not tuned['shipped'],
    }
