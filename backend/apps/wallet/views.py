from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from apps.common.emails import queue_coin_credit_email
from apps.common.pagination import KeysetPagination
from apps.notifications.services import notify

from .models import CoinRequest, Transaction, Wallet, apply


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'kind', 'amount', 'note', 'created_at']


class CoinRequestSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = CoinRequest
        fields = ['id', 'user', 'username', 'coins', 'amount', 'method', 'reference', 'screenshot_url', 'status', 'created_at']
        read_only_fields = ['id', 'user', 'status', 'created_at']


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
    return paginator.get_paginated_response(CoinRequestSerializer(rows, many=True).data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
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
        queue_coin_credit_email(
            obj.user, coins=obj.coins, amount=obj.amount, balance=wallet.balance,
            request_id=obj.pk, reference=obj.reference,
        )
    else:
        notify(obj.user, request.user, 'coins', 'Your coin purchase was rejected.', 'wallet', obj.pk)
    return Response(CoinRequestSerializer(obj).data)