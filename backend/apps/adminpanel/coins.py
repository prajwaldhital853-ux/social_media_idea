"""Contract 6.7: rupees in, coins out, the desk a person at the platform's bank
counter is judged at.

Three things are deliberately kept apart here. The *pricing* is what a visitor is
quoted and what the console can change without a deploy. The *queue* is the money
that has already moved and is waiting on a human, and a payment screenshot is
private: it is not handed to the console as a URL in the list but as a short-lived
signed link, so a proof does not sit readable in a browser history, a server log
or anyone who saved the page. The *ledger* is the wallet's own append-only history;
a manual adjustment writes a new row and never edits an old one, which is why the
reason is mandatory, the row says what happened, and only the reason says why.

Nothing in here re-implements the wallet. `wallet.apply()` is the only writer of a
balance, so a coin approval moves money exactly the way a promotion purchase does.
"""

from datetime import timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone

from apps.common import pulse
from apps.common.api import person
from apps.common.emails import mail_delivery_problem, queue_coin_decision_email
from apps.notifications.services import notify
from apps.wallet.models import CoinLot, CoinRequest, Transaction, Wallet, _whole, apply, credit_purchase

from . import settings_store
from .journal import record
from .models import AdminSetting, CoinReview

PROOF_SALT = 'adminpanel.coin-proof'
PROOF_TTL = 120

MONEY = {
    'approve': CoinReview.Action.APPROVE,
    'reject': CoinReview.Action.REJECT,
    'proof': CoinReview.Action.PROOF,
}
ACTION_LABELS = {
    CoinReview.Action.APPROVE: 'Approved',
    CoinReview.Action.REJECT: 'Rejected',
    CoinReview.Action.PROOF: 'Waiting on more proof',
    CoinReview.Action.PAID: 'Refund approved',
    CoinReview.Action.REFUSED: 'Refund refused',
}
# (setting key, the field the desk posts, the shape of the box)
PRICING_KEYS = ('coin_price', 'coin_min_purchase', 'coin_bank_name', 'coin_bank_account',
               'coin_bank_holder', 'coin_qr_url', 'coin_proof_days')
TEXT_KEYS = ('coin_bank_name', 'coin_bank_account', 'coin_bank_holder', 'coin_qr_url')


def pricing():
    """What a coin costs and where the rupees go, the open answer, no login needed."""
    values = settings_store.values()
    return {
        'coin_price': _rupees(values['coin_price']),
        'min_purchase': values['coin_min_purchase'],
        'bank': {
            'name': values['coin_bank_name'],
            'account': values['coin_bank_account'],
            'holder': values['coin_bank_holder'],
            'qr': values['coin_qr_url'],
        },
        'proof_days': values['coin_proof_days'],
    }


def _rupees(value):
    try:
        return Decimal(str(value)).quantize(Decimal('0.01'))
    except InvalidOperation:
        return Decimal('10.00')


def latest(request_pk):
    return CoinReview.objects.filter(request_id=request_pk).order_by('-created_at', '-id').first()


def row(req, review):
    """One queue row: the payer, the money, and a link to the proof, never the proof.

    The caller reads the last decision: the queue takes one grouped query for the
    whole page, so a row must not be able to ask for its own.
    """
    out = {
        'id': req.pk,
        'card': person(req.user),
        'coins': req.coins,
        'amount': str(req.amount),
        'method': req.method,
        'reference': req.reference,
        'status': req.status,
        'status_label': req.get_status_display(),
        'has_proof': bool(req.screenshot_url),
        'created_at': req.created_at.isoformat(),
        'reviewed_at': req.reviewed_at.isoformat() if req.reviewed_at else None,
        'took': str(review.created_at - req.created_at).split('.')[0] if review else None,
        'age_hours': round((timezone.now() - req.created_at).total_seconds() / 3600, 1),
    }
    if review is not None:
        out['review'] = {
            'action': review.action,
            'label': ACTION_LABELS.get(review.action, review.action),
            'reason': review.reason,
            'coins_credited': review.coins_credited,
            'by': review.actor.username if review.actor else None,
            'at': review.created_at.isoformat(),
        }
        out['asked'] = (
            review.action == CoinReview.Action.PROOF
            and (req.resubmitted_at is None or req.resubmitted_at < review.created_at)
        )
    # A newer ask writes a newer review, so the desk can tell a buyer who answered
    # from one who never did even while both are still pending.
    out['resubmitted'] = req.resubmitted_at is not None
    out['resubmitted_at'] = req.resubmitted_at.isoformat() if req.resubmitted_at else None
    # The refund chapter of the same purchase. Only read for a row that has one, so
    # the queue page costs nothing extra while nobody is asking for money back.
    out['refund'] = None
    if req.refund_requested_at or req.refunded_at or req.refund_refused_at:
        lot = getattr(req, 'lot', None)
        out['refund'] = {
            'requested_at': req.refund_requested_at.isoformat() if req.refund_requested_at else None,
            'reference': req.refund_reference,
            'reason': req.refund_reason,
            'has_proof': bool(req.refund_screenshot_url),
            'coins': str(lot.held) if lot is not None else None,
            'paid_at': req.refunded_at.isoformat() if req.refunded_at else None,
            'refused_at': req.refund_refused_at.isoformat() if req.refund_refused_at else None,
            'refused_reason': req.refund_refuse_reason,
        }
    return out


def asks(request_pk):
    """Every proof request on one purchase, oldest first, the paper behind a delay."""
    return [
        {
            'action': item.action, 'reason': item.reason,
            'by': item.actor.username if item.actor else None,
            'at': item.created_at.isoformat(),
        }
        for item in CoinReview.objects.filter(request_id=request_pk).order_by('created_at', 'id')
    ]


def find_request(pk):
    """The request row, with the payer already attached. Deciding still checks the status."""
    return CoinRequest.objects.filter(pk=pk).select_related('user').first()


def decide(req, actor, action, reason=''):
    """Approve, reject or ask again. Returns (status_code, body)."""
    reason = str(reason or '').strip()
    if action not in MONEY:
        return 400, {'detail': 'Approve, reject or ask for more proof.'}
    if req.status != CoinRequest.Status.PENDING:
        return 409, {'detail': f'That request was already {req.status}. Nothing here changed it again.'}
    if action != 'approve' and not reason:
        missing = ('Say why the money is not being credited, the person is told this sentence.'
                   if action == 'reject' else 'Write what more you need from them.')
        return 400, {'detail': missing}

    entry = None
    with transaction.atomic():
        # The row is locked and its status re-read before any money moves: two seats
        # deciding the same request at the same moment must meet at the first one's
        # verdict instead of both crediting the wallet.
        req = CoinRequest.objects.select_for_update().select_related('user').get(pk=req.pk)
        if req.status != CoinRequest.Status.PENDING:
            return 409, {'detail': f'That request was already {req.status}. Nothing here changed it again.'}
        review = CoinReview(request=req, actor=actor, action=MONEY[action], reason=reason[:240])
        if action == 'approve':
            wallet, _ = Wallet.objects.get_or_create(user=req.user)
            entry = credit_purchase(wallet, req, actor=actor)
            wallet.refresh_from_db()
            req.status = CoinRequest.Status.APPROVED
            review.coins_credited = req.coins
            body = {'coins_credited': req.coins, 'balance': str(wallet.balance)}
            say = f'Your purchase of {req.coins} coins was approved and credited to your wallet.'
        elif action == 'reject':
            req.status = CoinRequest.Status.REJECTED
            body = {'coins_credited': 0, 'balance': None}
            say = f'Your coin purchase was rejected: {reason}'
        else:
            body = {'coins_credited': 0, 'balance': None}
            say = f'The platform needs more proof of your payment: {reason}'

        req.reviewed_at = timezone.now() if action != 'proof' else req.reviewed_at
        req.save(update_fields=['status', 'reviewed_at'])
        review.save()
    # An ask sends the buyer to the page that answers it; a decision sends them to
    # the wallet, where the money they were credited or refused is visible.
    notify(req.user, actor, 'coins', say[:240],
           'coin_proof' if action == 'proof' else 'wallet', req.pk)
    record(actor, f'coins_{action}', f'coin_request:{req.pk}',
           f'{req.coins} coins / NPR {req.amount}, ' + (reason or 'approved, wallet credited'))
    if action in ('approve', 'reject', 'proof'):
        queue_coin_decision_email(
            req.user, action=action, coins=req.coins, amount=req.amount,
            balance=(wallet.balance if action == 'approve' else None),
            request_id=req.pk, reference=req.reference, reason=reason,
        )
    # The badge on the member's own row and the pile on the console's screen both move
    # the instant this verdict is written. A seat that has to press refresh to see its
    # own click land is a seat that clicks twice.
    pulse.to_user(req.user.pk, 'coin_decision', id=str(req.pk), status=req.status,
                  coins=req.coins, balance=body['balance'])
    pulse.to_staff('coin_request', id=str(req.pk), status=req.status)
    return 200, {'detail': _said(action, req, entry), 'request': row(req, review),
                 'asks': asks(req.pk), 'mail': _mail_note(action), **body}


def settle(req, actor, reason=''):
    """Task 6.7b: the rupees went back over the counter, so the coins come off the account.

    The payment itself is never made here — the money was already verified when the
    purchase was approved, and a desk that paid refunds from the platform's own bank
    session has one thing left to record: that it did. This takes the locked coins
    out of the wallet, closes the batch they came from, and writes the three paper
    trails a dispute is settled from: the review row, the audit line, the ledger debit.
    """
    reason = str(reason or '').strip()
    if req.refunded_at is not None:
        return 409, {'detail': 'That refund was already settled. Nothing moved again.'}
    if req.status != CoinRequest.Status.APPROVED or req.refund_requested_at is None:
        return 409, {'detail': 'Nobody is waiting on a refund for this purchase, so there is nothing to settle.'}
    entry = None
    coins_back = Decimal('0')
    try:
        with transaction.atomic():
            req = CoinRequest.objects.select_for_update().get(pk=req.pk)
            lot = CoinLot.objects.select_for_update().filter(request=req).first()
            if lot is None or lot.held <= 0:
                return 409, {'detail': 'Those coins are no longer locked for a refund, '
                                       'so this cannot be paid from the desk. Ask the buyer to file the request again.'}
            coins_back = lot.held
            # The hold is released before the debit: `apply()` refuses to spend a locked
            # coin, and the coin this settlement returns is exactly the locked one. The
            # batch is not written down here, it is named to `apply()` and closed there,
            # because a debit that also eats the oldest free lot spends a second purchase
            # that nobody ever touched.
            lot.held = Decimal('0')
            lot.save(update_fields=['held'])
            wallet, _ = Wallet.objects.get_or_create(user=req.user)
            entry = apply(wallet.pk, Transaction.Kind.DEBIT, coins_back,
                          f'Coin purchase {req.pk} refunded',
                          actor=actor, ref=f'coin_refund:{req.pk}', from_lot=lot.pk)
            wallet.refresh_from_db()
            req.status = CoinRequest.Status.REFUNDED
            req.refunded_at = timezone.now()
            req.reviewed_at = req.refunded_at
            req.save(update_fields=['status', 'refunded_at', 'reviewed_at'])
            review = CoinReview(request=req, actor=actor, action=CoinReview.Action.PAID,
                                reason=reason[:240], coins_credited=0)
            review.save()
    except ValueError as err:
        return 400, {'detail': str(err)}
    paid = f'{req.amount:,.2f}'
    say = (f'{_whole(coins_back)} coins came off your wallet: the refund for purchase #{req.pk} '
           f'of NPR {paid} was approved and paid to you.')
    notify(req.user, actor, 'coins', say[:240], 'wallet', req.pk)
    record(actor, 'coins_paid', f'coin_request:{req.pk}',
           f'{_whole(coins_back)} coins taken back, NPR {paid} refunded by hand, '
           + (reason or f'bank reference {req.refund_reference or req.reference or "not stated"}'))
    queue_coin_decision_email(
        req.user, action='paid', coins=req.coins, amount=req.amount,
        balance=wallet.balance, request_id=req.pk,
        reference=req.refund_reference or req.reference, reason=reason,
    )
    pulse.to_user(req.user.pk, 'coin_decision', id=str(req.pk), status=req.status, coins=req.coins,
                  balance=str(wallet.balance))
    pulse.to_staff('coin_request', id=str(req.pk), status=req.status)
    return 200, {
        'detail': (f'Refund settled. {_whole(coins_back)} coins were debited from @{req.user.username} '
                   f'as ledger row #{entry.pk}. That row cannot be edited.'),
        'request': row(req, review),
        'asks': asks(req.pk),
        'mail': _mail_note('paid'),
        'coins_taken': _whole(coins_back),
        'balance': str(wallet.balance),
    }


def refuse(req, actor, reason=''):
    """Turn a refund ask down. The coins go back into the wallet's reach, nothing else moves.

    The desk is allowed to say no: a purchase paid through a third-party wallet, an ask
    filed weeks after approval, a receipt that belongs to somebody else. What is not
    allowed is a silent no, so the sentence is compulsory, the buyer's badge changes to
    match it, and the lock comes off before the door closes. A refusal is not a second
    purchase, so the request keeps its approved standing and its ledger row untouched.
    """
    reason = str(reason or '').strip()
    if not reason:
        return 400, {'detail': 'Write why the refund is being turned down. The buyer is shown this sentence.'}
    if req.refund_refused_at is not None:
        return 409, {'detail': 'That refund was already refused. Nothing moved again.'}
    if req.refunded_at is not None:
        return 409, {'detail': 'That refund was already paid. A paid refund cannot be refused after the fact.'}
    if req.status != CoinRequest.Status.APPROVED or req.refund_requested_at is None:
        return 409, {'detail': 'Nobody is waiting on a refund for this purchase, so there is nothing to refuse.'}
    coins_back = Decimal('0')
    with transaction.atomic():
        req = CoinRequest.objects.select_for_update().get(pk=req.pk)
        if req.refund_refused_at is not None:
            return 409, {'detail': 'That refund was already refused. Nothing moved again.'}
        lot = CoinLot.objects.select_for_update().filter(request=req).first()
        coins_back = lot.held if lot is not None else Decimal('0')
        if lot is not None and lot.held > 0:
            lot.held = Decimal('0')
            lot.save(update_fields=['held'])
        req.refund_refused_at = timezone.now()
        req.refund_refuse_reason = reason[:240]
        req.reviewed_at = req.refund_refused_at
        req.save(update_fields=['refund_refused_at', 'refund_refuse_reason', 'reviewed_at'])
        review = CoinReview(request=req, actor=actor, action=CoinReview.Action.REFUSED,
                           reason=reason[:240], coins_credited=0)
        review.save()
    wallet, _ = Wallet.objects.get_or_create(user=req.user)
    say = f'Your refund request for purchase #{req.pk} was refused: {reason}'
    notify(req.user, actor, 'coins', say[:240], 'wallet', req.pk)
    record(actor, 'coins_refund_refused', f'coin_request:{req.pk}',
           f'{_whole(coins_back)} coins unlocked, refund refused: {reason}')
    queue_coin_decision_email(
        req.user, action='refused', coins=req.coins, amount=req.amount,
        balance=wallet.balance, request_id=req.pk,
        reference=req.refund_reference or req.reference, reason=reason,
    )
    pulse.to_user(req.user.pk, 'coin_decision', id=str(req.pk), status=req.status,
                  coins=req.coins, balance=str(wallet.balance), refund='refused')
    pulse.to_staff('coin_request', id=str(req.pk), status=req.status)
    return 200, {
        'detail': (f'Refund refused. {_whole(coins_back)} coins were released back to '
                   f'@{req.user.username}, nothing was taken from the wallet.'),
        'request': row(req, review),
        'asks': asks(req.pk),
        'mail': _mail_note('refused'),
        'coins_released': _whole(coins_back),
        'balance': str(wallet.balance),
    }


def _mail_note(action):
    """What the seat is told about the letter, so a dead provider stops being invisible."""
    problem = mail_delivery_problem()
    if not problem:
        return ''
    return (f'The member was notified in the app, but the email was NOT sent. {problem}')


def _said(action, req, entry):
    if action == 'approve':
        return (f'Credited {req.coins} coins to @{req.user.username}. '
                f'The ledger row is #{entry.pk} and it cannot be edited.')
    if action == 'reject':
        return f'Rejected and @{req.user.username} was told why. No coins moved.'
    return f'Asked @{req.user.username} for more proof. The request stays open.'


def proof_token(req, actor, which='payment'):
    return signing.dumps({'r': req.pk, 'u': actor.pk, 'p': which}, salt=PROOF_SALT)


def proof_file(req, actor_id, token, ttl=PROOF_TTL):
    """Open a proof through its link. Returns (response, None) or (None, reason)."""
    try:
        payload = signing.loads(token, max_age=ttl, salt=PROOF_SALT)
    except signing.BadSignature:
        return None, ('This proof link has expired. Ask for it again.', 410)
    if payload.get('r') != req.pk or str(payload.get('u')) != str(actor_id):
        return None, ('That link was not made for this proof, or not for you.', 403)
    which = payload.get('p') or 'payment'
    name = _media_name(_proof_url(req, which))
    if not name:
        return None, (f'There is no {which} screenshot on this request.', 404)
    try:
        handle = default_storage.open(name)
    except (FileNotFoundError, OSError, NotImplementedError):
        return None, ('The file behind that link is no longer on the server.', 404)
    return FileResponse(handle, as_attachment=False), None


def _proof_url(req, which):
    """The one picture a link was minted for: the payment, or the refund ask."""
    return req.refund_screenshot_url if which == 'refund' else req.screenshot_url


def _media_name(url):
    """The storage path out of a media URL, or None if it is not one of ours."""
    if not url:
        return None
    media_url = getattr(settings, 'MEDIA_URL', '/media/')
    base = media_url.strip('/')
    path = urlsplit(url).path.lstrip('/')
    if path == base:
        return ''
    if path.startswith(base + '/'):
        return path[len(base) + 1:]
    return None


def sweep(now=None):
    """Delete the payment proofs the retention window has passed.

    A person paid real money and handed over a picture of their own bank record;
    keeping it after the purchase is settled is a liability the contract asks the
    Admin to bound, so the number is a row and this is what reads it. Proofs on a
    request nobody ever decided go on the same clock from the day they were
    uploaded, otherwise an abandoned purchase is held forever.
    """
    now = now or timezone.now()
    # Not `get(...) or 30`: zero is the Admin's word for "delete the picture as soon
    # as the purchase is settled", and a falsy default would turn that into a month.
    held_days = settings_store.get('coin_proof_days')
    days = 30 if held_days is None else int(held_days)
    cutoff = now - timedelta(days=days)
    held = CoinRequest.objects.filter(~Q(screenshot_url='') | ~Q(refund_screenshot_url=''))
    # A refund the buyer asked for and the desk has not paid is still an open case:
    # the picture it was filed with is the one the seat has to look at before it wires
    # the money, so the clock does not run on it.
    open_refund = Q(refund_requested_at__isnull=False, refunded_at__isnull=True)
    overdue = list(held.filter(
        status__in=[CoinRequest.Status.APPROVED, CoinRequest.Status.REJECTED, CoinRequest.Status.REFUNDED],
        reviewed_at__lt=cutoff,
    ).exclude(open_refund)) + list(held.filter(status=CoinRequest.Status.PENDING, created_at__lt=cutoff))
    cleared = []
    for req in overdue:
        for field in ('screenshot_url', 'refund_screenshot_url'):
            name = _media_name(getattr(req, field))
            if name:
                try:
                    default_storage.delete(name)
                except (FileNotFoundError, OSError, NotImplementedError):
                    pass
            setattr(req, field, '')
        req.save(update_fields=['screenshot_url', 'refund_screenshot_url'])
        cleared.append(req.pk)
    # Deliberately not an audit row: the log is the story of what staff *did*, and a
    # sweep that runs whenever the queue is opened would turn "who is holding a
    # receipt" into a page-load counter. The number the console shows is the
    # evidence, and the file is gone either way.
    return {'days': days, 'cleared': len(cleared), 'requests': cleared}


def entry_row(entry):
    """One ledger row, with the wallet’s present number beside it.

    Deliberately not a running balance: the row's own figures are the record, and a
    column that subtracted its way back through the table would print a negative
    balance for any wallet whose number was set outside `apply()`, which is what
    every seeded demo account is. The screen says “Wallet now” because that is
    exactly what the number is.
    """
    return {
        'id': entry.pk,
        'username': entry.wallet.user.username,
        'card': person(entry.wallet.user),
        'kind': entry.kind,
        'amount': str(entry.amount),
        'note': entry.note,
        'staff': entry.actor.username if entry.actor_id else None,
        'ref': entry.ref,
        'created_at': entry.created_at.isoformat(),
        'balance': str(entry.wallet.balance),
        'currency': entry.wallet.currency,
    }


def adjust(actor, username, direction, amount, reason):
    """A hand-written ledger row. The reason is not optional, and nothing is edited."""
    reason = str(reason or '').strip()
    if not reason:
        return 400, {'detail': 'Write the reason the balance moved. It stays on the ledger row forever.'}
    if direction not in (Transaction.Kind.CREDIT, Transaction.Kind.DEBIT):
        return 400, {'detail': 'Credit or debit.'}
    try:
        money = Decimal(str(amount))
    except (TypeError, InvalidOperation):
        return 400, {'detail': 'That is not an amount.'}
    if money <= 0:
        return 400, {'detail': 'An adjustment has to move coins, not zero.'}
    user = get_user_model().objects.filter(username=username).first()
    if user is None:
        return 404, {'detail': f'No account called {username}.'}
    wallet, _ = Wallet.objects.get_or_create(user=user)
    try:
        entry = apply(wallet.pk, direction, money, reason[:200], actor=actor, ref='manual')
    except ValueError as err:
        return 400, {'detail': str(err)}
    wallet.refresh_from_db()
    # `apply()` moved the balance with a query, so the object hanging off the new row
    # still holds the number from before it moved. The row is the freshest one, so the
    # wallet's present balance is the one worth printing beside it.
    entry.wallet = wallet
    record(actor, 'coin_adjust', f'user:{username}',
           f'{direction} {money} coins, {reason}')
    word = 'Credited' if direction == Transaction.Kind.CREDIT else 'Debited'
    return 200, {
        'detail': f'{word} {entry.amount} coins to @{username}. That is a new ledger row, not an edit: '
                  'nothing already written was touched.',
        'entry': entry_row(entry),
        'balance': str(wallet.balance),
    }


def settings_lines(group='payments'):
    """Every knob in a group, with who last turned it."""
    cached = settings_store.cached()
    written = {row.key: row for row in AdminSetting.objects.filter(key__in=cached)}
    out = []
    for key, item in cached.items():
        if item['group'] != group:
            continue
        row = written.get(key)
        out.append({
            **item,
            'by': row.updated_by.username if row is not None and row.updated_by else None,
            'at': row.updated_at.isoformat() if row is not None else None,
        })
    return out


def write_pricing(actor, posted):
    """Apply the desk's boxes. Returns (status, body, changed_labels)."""
    cached = settings_store.cached()
    updates, bad = {}, []
    for key in PRICING_KEYS:
        if key not in posted:
            continue
        raw = posted.get(key)
        raw = '' if raw is None else str(raw).strip()
        if key in TEXT_KEYS:
            if len(raw) > 120:
                bad.append(f'{cached[key]["label"]} is too long.')
                continue
            updates[key] = raw
            continue
        try:
            number = Decimal(raw) if raw != '' else None
        except InvalidOperation:
            bad.append(f'{cached[key]["label"]} has to be a number.')
            continue
        if number is not None and number < 0:
            bad.append(f'{cached[key]["label"]} cannot be negative.')
            continue
        if key == 'coin_price' and number is not None and number <= 0:
            bad.append('A Coin has to cost something. Set a price above zero rupees.')
            continue
        updates[key] = str(number) if number is not None else ''
    if bad:
        return 400, {'detail': ' '.join(bad)}, []

    stored = {row.key: (row.value or '') for row in AdminSetting.objects.filter(key__in=PRICING_KEYS)}
    moved = [key for key in updates if stored.get(key, '') != updates[key]]
    if not moved:
        return 400, {'detail': 'Nothing to save, the desk already says exactly this.'}, []
    settings_store.write(actor, {key: updates[key] for key in moved})
    labels = [cached[key]['label'] for key in moved]
    record(actor, 'coin_settings', 'coin pricing', 'Changed ' + ', '.join(labels) + '.')
    return 200, {}, labels
