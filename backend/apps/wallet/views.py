from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.adminpanel import bell, rbac, settings_store
from apps.adminpanel.journal import record
from apps.common.emails import queue_coin_decision_email, queue_coin_request_email, queue_refund_request_email
from apps.common.pagination import KeysetPagination
from apps.notifications.services import notify

from .models import CoinLot, CoinRequest, Transaction, Wallet, credit_purchase


def _proof_asks(rows):
    """The proof an admin still waits on, keyed by request — one query per page.

    A request is owed a new screenshot when its newest proof ask is later than the
    last time the buyer answered one, so a second ask re-opens the request without
    any flag that could be left switched on.
    """
    from apps.adminpanel.models import CoinReview

    pending = [row.pk for row in rows if row.status == CoinRequest.Status.PENDING]
    if not pending:
        return {}
    answered = {row.pk: row.resubmitted_at for row in rows}
    asks = {}
    for review in (CoinReview.objects
                   .filter(request_id__in=pending, action=CoinReview.Action.PROOF)
                   .order_by('request_id', '-created_at', '-id')
                   .distinct('request_id')):
        stamp = answered.get(review.request_id)
        if stamp is None or stamp < review.created_at:
            asks[review.request_id] = review
    return asks


def _promo_pending(user):
    """Is one of this person's campaign orders still with the desk?

    A pending promotion is coins the platform promised to take and has not taken yet.
    Refunding a purchase while that order sits hands back money the other queue is
    about to spend, so one open order at a time is the rule on both doors.
    """
    from apps.promotions.models import Promotion

    return Promotion.objects.filter(owner=user, status=Promotion.Status.PENDING).exists()


def _open_refunds(user):
    """The ids of this person's purchases whose refund ask the desk has not answered.

    One ask at a time, the same rule the promotion queue runs on. A seat settles a
    refund against a batch it can still see whole, and two asks open at once are two
    locks nobody can untangle in the right order.
    """
    return set(CoinRequest.objects.filter(
        user=user, refund_requested_at__isnull=False,
        refunded_at__isnull=True, refund_refused_at__isnull=True,
    ).values_list('pk', flat=True))


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'kind', 'amount', 'note', 'created_at']


class CoinRequestSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = CoinRequest
        fields = ['id', 'user', 'username', 'coins', 'amount', 'method', 'reference',
                  'screenshot_url', 'status', 'created_at', 'resubmitted_at',
                  'refund_requested_at', 'refunded_at', 'refund_refused_at',
                  'refund_reference', 'refund_reason', 'refund_refuse_reason']
        read_only_fields = ['id', 'user', 'status', 'created_at', 'resubmitted_at',
                            'refund_requested_at', 'refunded_at', 'refund_refused_at',
                            'refund_reference', 'refund_reason', 'refund_refuse_reason']


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def wallet_detail(request):
    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(wallet.transactions.all(), request)
    response = paginator.get_paginated_response(TransactionSerializer(rows, many=True).data)
    response.data['balance'] = wallet.balance
    response.data['currency'] = wallet.currency
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def coin_request_create(request):
    serializer = CoinRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if serializer.validated_data['coins'] < 1:
        return Response({'detail': 'Coins must be at least 1.'}, status=400)
    # One order in the queue per person. The desk judges a receipt against the request it
    # belongs to, so a second one before the first is answered is two payments to read for
    # one buyer. An ask for more proof is answered on that request, not with a new one.
    waiting = CoinRequest.objects.filter(
        user=request.user, status=CoinRequest.Status.PENDING,
    ).order_by('-created_at').first()
    if waiting:
        if _proof_asks([waiting]).get(waiting.pk):
            return Response(
                {'detail': f'Coin request #{waiting.pk} is waiting on a new screenshot from you. '
                           'Send it on that request before making another one.'},
                status=409,
            )
        return Response(
            {'detail': f'Coin request #{waiting.pk} is still waiting for the admin. Please wait '
                       'for it to be approved or refused before sending another request.'},
            status=409,
        )
    # The desk's floor is the door's floor: a stale page quoting yesterday's
    # minimum must not slip a smaller purchase past it. Zero turns the rule off.
    floor = int(settings_store.get('coin_min_purchase') or 0)
    if floor and serializer.validated_data['coins'] < floor:
        return Response({'detail': f'The smallest purchase is {floor} coins.'}, status=400)
    obj = serializer.save(user=request.user)
    # The seat that clears purchases is not sitting in the desk watching it fill, so
    # the letter is what tells them money arrived today.
    queue_coin_request_email(obj)
    return Response(CoinRequestSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def coin_request_list(request):
    qs = CoinRequest.objects.all() if request.user.is_staff else CoinRequest.objects.filter(user=request.user)
    if request.query_params.get('status'):
        qs = qs.filter(status=request.query_params['status'])
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs.select_related('user'), request)
    data = CoinRequestSerializer(rows, many=True).data
    asks = _proof_asks(rows)
    lots = {lot.request_id: lot for lot in CoinLot.objects.filter(request_id__in=[row.pk for row in rows])}
    # One read for the whole page, not one per row: only an approved purchase has a
    # door that could still open, so a wallet of settled history costs nothing here.
    promo_open = any(row.status == CoinRequest.Status.APPROVED for row in rows) and _promo_pending(request.user)
    open_refunds = _open_refunds(request.user)
    for row, item in zip(rows, data):
        review = asks.get(row.pk)
        item['proof_asked'] = review is not None
        item['proof_reason'] = review.reason if review else ''
        item['resubmitted'] = row.resubmitted_at is not None
        lot = lots.get(row.pk)
        spent = lot is not None and not lot.untouched
        # One ask is the whole queue, so an open ask on any other purchase closes the
        # door on this one too.
        other_open = bool(open_refunds - {row.pk})
        # The button's whole rule lives here, on the row: a purchase is refundable
        # while it is approved, nobody has asked yet, and not one coin of its batch has
        # been spent. Once a coin is gone the answer never comes back to yes.
        item['refundable'] = bool(
            row.status == CoinRequest.Status.APPROVED and row.refund_requested_at is None
            and row.refunded_at is None and row.refund_refused_at is None
            and lot is not None and lot.untouched and not promo_open and not other_open
        )
        item['refund_requested'] = row.refund_requested_at is not None
        item['refunded'] = row.refunded_at is not None
        item['refund_refused'] = row.refund_refused_at is not None
        item['refund_locked'] = bool(row.refund_requested_at and not row.refunded_at
                                     and not row.refund_refused_at)
        # Two different reasons the door is shut on an approved purchase, and the row
        # has to say which one it is: a person who spent a coin needs a sentence, not a
        # button that quietly stopped existing.
        item['refund_spent'] = bool(spent and row.refund_requested_at is None
                                    and row.refunded_at is None and row.refund_refused_at is None)
        item['refund_promo_pending'] = bool(promo_open and row.status == CoinRequest.Status.APPROVED
                                            and row.refund_requested_at is None
                                            and row.refunded_at is None and row.refund_refused_at is None)
        item['refund_other_open'] = bool(other_open and row.status == CoinRequest.Status.APPROVED
                                         and row.refund_requested_at is None
                                         and row.refunded_at is None and row.refund_refused_at is None)
        item['locked_coins'] = str(lot.held) if lot is not None else '0'
    return paginator.get_paginated_response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def coin_refund_request(request, pk):
    """Ask for an approved purchase back, and put those coins under lock while it waits.

    The lock is the honest half of the promise. A refund the platform intends to pay
    while the buyer is still free to spend the coins is a refund that ends with an
    empty wallet and an angry person, so the batch is held the moment the ask is
    filed, and every spend door refuses to touch a held coin until the desk settles it.
    A purchase with even one coin gone is refused for good: a part-spent batch has no
    clean number to give back, and a button that disappears once and for all is easier
    to trust than one that lies about what is left.
    """
    screenshot = str(request.data.get('screenshot_url') or '').strip()
    reference = str(request.data.get('reference') or '').strip()
    reason = str(request.data.get('reason') or '').strip()
    if not screenshot:
        return Response({'detail': 'Attach the screenshot of the payment you want back.'}, status=400)
    if not reason:
        return Response({'detail': 'Write why you want the refund. The desk reads this sentence.'}, status=400)
    if len(screenshot) > 200 or len(reference) > 80 or len(reason) > 240:
        return Response({'detail': 'That is too long to record.'}, status=400)
    with transaction.atomic():
        # One ask is the whole queue, so the queue is read under lock: every purchase
        # of this wallet is taken in the same order on every tap, which is what stops
        # two requests filed at the same moment from both seeing an empty queue.
        list(CoinRequest.objects.select_for_update().filter(user=request.user)
             .order_by('pk').values_list('pk', flat=True))
        req = CoinRequest.objects.select_for_update().filter(pk=pk, user=request.user).first()
        if req is None:
            return Response({'detail': 'No coin request of yours has that id.'}, status=404)
        if req.refunded_at is not None:
            return Response({'detail': 'That purchase was already refunded.'}, status=409)
        if req.refund_refused_at is not None:
            return Response(
                {'detail': 'The desk already answered this refund request and turned it down. '
                           'The purchase stays as it was.'},
                status=409,
            )
        if req.status != CoinRequest.Status.APPROVED:
            return Response(
                {'detail': f'Only an approved purchase can be refunded. This one is {req.status}.'},
                status=409,
            )
        lot = CoinLot.objects.select_for_update().filter(request=req).first()
        if req.refund_requested_at is not None or (lot is not None and lot.held > 0):
            return Response({'detail': 'A refund for this purchase is already with the desk.'}, status=409)
        waiting = (CoinRequest.objects.filter(user=request.user, refund_requested_at__isnull=False,
                                             refunded_at__isnull=True, refund_refused_at__isnull=True)
                   .exclude(pk=req.pk).order_by('-refund_requested_at').first())
        if waiting is not None:
            return Response(
                {'detail': f'Purchase #{waiting.pk} already has a refund request waiting for the desk. '
                           'Wait for it to be settled before asking for another one.'},
                status=409,
            )
        # Two queues, one wallet. A campaign that is still waiting on approval has not
        # been charged yet, so refunding underneath it would give back coins the desk is
        # about to take.
        if _promo_pending(request.user):
            return Response(
                {'detail': 'You have a promotion request pending, so you cannot ask for a refund. '
                           'The promotion desk has to answer that order first.'},
                status=409,
            )
        if lot is None or not lot.untouched:
            return Response(
                {'detail': 'Some of those coins have already been spent, so this purchase can no longer '
                           'be refunded.'},
                status=409,
            )
        lot.held = lot.remaining
        lot.save(update_fields=['held'])
        req.refund_requested_at = timezone.now()
        req.refund_screenshot_url = screenshot
        req.refund_reference = reference
        req.refund_reason = reason
        req.save(update_fields=['refund_requested_at', 'refund_screenshot_url',
                                'refund_reference', 'refund_reason'])
    notify(request.user, request.user, 'coins',
           f'You asked for a refund on purchase #{req.pk}. {req.coins} coins are locked until the desk settles it.',
           'wallet', req.pk)
    bell.announce(
        'coin_refund',
        f'@{request.user.username} asked for a refund on purchase #{req.pk} ({req.coins} coins / NPR {req.amount}).',
        f'/coins/{req.pk}', 'coins_review',
    )
    record(request.user, 'coins_refund_ask', f'coin_request:{req.pk}',
           f'{req.coins} coins locked, {reason or "no reason given"}')
    # The letter is the half of this promise the wallet screen cannot make: the wait
    # the member is owed, and every rule the ask was measured against. Queued off the
    # request, like every other letter, so a silent provider never stalls the ask.
    queue_refund_request_email(req, locked=lot.held)
    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    try:
        from apps.common import pulse
        pulse.to_user(request.user.pk, 'coins', balance=str(wallet.balance), held=str(lot.held))
    except Exception:  # noqa: BLE001 - the lock is written; the wire is a courtesy
        pass
    return Response({'detail': 'Refund requested. Those coins are locked until the desk settles it.',
                     'request': CoinRequestSerializer(req).data})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def coin_proof_resubmit(request, pk):
    """Answering "we need more proof", on the purchase that is already open.

    The buyer never raises a second request: the desk is watching one row, and a
    new row would be a second payment for the same coins that nobody has to
    reconcile. The screenshot and the reference are replaced in place and the ask
    is stamped as answered, which is what closes the banner.
    """
    req = CoinRequest.objects.filter(pk=pk, user=request.user).first()
    if not req:
        return Response({'detail': 'No coin request of yours has that id.'}, status=404)
    ask = _proof_asks([req]).get(req.pk)
    if request.method == 'GET':
        return Response({
            'request': CoinRequestSerializer(req).data,
            'asked': ask is not None,
            'reason': ask.reason if ask else '',
            'asked_at': ask.created_at if ask else None,
        })
    if req.status != CoinRequest.Status.PENDING:
        return Response(
            {'detail': f'That request was already {req.status}. There is nothing to add to it.'},
            status=409,
        )
    if ask is None:
        return Response({'detail': 'Nobody has asked you for more proof on this request.'}, status=409)
    screenshot = str(request.data.get('screenshot_url') or '').strip()
    reference = str(request.data.get('reference') or '').strip()
    if not screenshot:
        return Response({'detail': 'Attach the screenshot of the payment.'}, status=400)
    if len(screenshot) > 200 or len(reference) > 80:
        return Response({'detail': 'That is too long to record.'}, status=400)

    req.screenshot_url = screenshot
    if reference:
        req.reference = reference
    req.resubmitted_at = timezone.now()
    req.save(update_fields=['screenshot_url', 'reference', 'resubmitted_at'])
    # The seat that asked is the seat that has to see the answer. The target is
    # the request itself, not the member's proof page: staff reading this belongs
    # in the console, and the resubmit screen would only tell them it is not theirs.
    if ask.actor_id:
        notify(
            ask.actor, req.user, 'coins',
            f'@{req.user.username} sent new proof for the {req.coins} coin purchase '
            f'of NPR {req.amount}. The request is still open.',
            'coin_request', req.pk,
        )
    record(req.user, 'coins_resubmit', f'coin_request:{req.pk}',
           f'{req.coins} coins / NPR {req.amount}, new proof uploaded')
    return Response({'detail': 'Proof sent. The request stays open until the desk decides.',
                     'request': CoinRequestSerializer(req).data})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coins_review')
def coin_request_review(request, pk, action):
    if action not in ('approve', 'reject'):
        return Response({'detail': 'Unknown action.'}, status=400)
    with transaction.atomic():
        obj = (CoinRequest.objects.select_for_update()
               .filter(pk=pk, status=CoinRequest.Status.PENDING).select_related('user').first())
        if not obj:
            return Response({'detail': 'No pending request with that id.'}, status=404)
        if action == 'approve':
            wallet, _ = Wallet.objects.get_or_create(user=obj.user)
            credit_purchase(wallet, obj, actor=request.user)
            wallet.refresh_from_db()
            obj.status = CoinRequest.Status.APPROVED
        else:
            obj.status = CoinRequest.Status.REJECTED
        obj.reviewed_at = timezone.now()
        obj.save(update_fields=['status', 'reviewed_at'])
    if action == 'approve':
        notify(obj.user, request.user, 'coins', f'Your purchase of {obj.coins} coins was approved.', 'wallet', wallet.pk)
        queue_coin_decision_email(
            obj.user, action='approve', coins=obj.coins, amount=obj.amount,
            balance=wallet.balance, request_id=obj.pk, reference=obj.reference,
        )
    else:
        notify(obj.user, request.user, 'coins', 'Your coin purchase was rejected.', 'wallet', obj.pk)
        queue_coin_decision_email(
            obj.user, action='reject', coins=obj.coins, amount=obj.amount,
            request_id=obj.pk, reference=obj.reference,
        )
    try:
        from apps.common import pulse
        # The id is the whole frame: the member's wallet reads it to find the row whose
        # badge just turned over, and a frame without one is dropped on the floor.
        pulse.to_user(obj.user.pk, 'coin_decision', id=str(obj.pk), status=obj.status,
                      coins=obj.coins, balance=wallet.balance if action == 'approve' else None)
        pulse.to_staff('coin_request', id=str(obj.pk), status=obj.status)
    except Exception:  # noqa: BLE001 - the decision is saved; the wire is a courtesy
        pass
    return Response(CoinRequestSerializer(obj).data)