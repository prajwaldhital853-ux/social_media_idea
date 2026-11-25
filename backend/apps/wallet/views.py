from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.adminpanel import rbac
from apps.adminpanel.journal import record
from apps.common.emails import queue_coin_decision_email
from apps.common.pagination import KeysetPagination
from apps.notifications.services import notify

from .models import CoinRequest, Transaction, Wallet, apply


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


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'kind', 'amount', 'note', 'created_at']


class CoinRequestSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = CoinRequest
        fields = ['id', 'user', 'username', 'coins', 'amount', 'method', 'reference',
                  'screenshot_url', 'status', 'created_at', 'resubmitted_at']
        read_only_fields = ['id', 'user', 'status', 'created_at', 'resubmitted_at']


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
    obj = serializer.save(user=request.user)
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
    for row, item in zip(rows, data):
        review = asks.get(row.pk)
        item['proof_asked'] = review is not None
        item['proof_reason'] = review.reason if review else ''
        item['resubmitted'] = row.resubmitted_at is not None
    return paginator.get_paginated_response(data)


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
           f'{req.coins} coins / NPR {req.amount} — new proof uploaded')
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
            apply(wallet.pk, Transaction.Kind.CREDIT, obj.coins, f'Coin purchase {obj.pk} approved')
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
    return Response(CoinRequestSerializer(obj).data)