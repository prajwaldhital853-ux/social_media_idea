from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser, IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from apps.common.api import person
from apps.common.config import package_by_id
from apps.common.pagination import KeysetPagination
from apps.marketplace.models import Listing
from apps.posts.models import Post
from apps.wallet.models import Transaction, Wallet, apply

from .models import Promotion


class PromotionSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = Promotion
        fields = [
            'id', 'owner', 'owner_username', 'target_type', 'target_id', 'category', 'age_min', 'age_max',
            'country', 'city', 'budget', 'package', 'status', 'impressions', 'clicks',
            'created_at', 'ends_at',
        ]
        read_only_fields = ['id', 'owner', 'status', 'impressions', 'clicks', 'created_at', 'ends_at']

    def validate(self, attrs):
        if attrs.get('age_min', 13) > attrs.get('age_max', 65):
            raise serializers.ValidationError('age_min cannot exceed age_max.')
        budget = attrs.get('budget', 0)
        if budget < 0:
            raise serializers.ValidationError('Budget cannot be negative.')
        package_id = attrs.get('package')
        if package_id and not package_by_id(package_id):
            raise serializers.ValidationError('Unknown package.')
        return attrs


def _row(promo):
    return PromotionSerializer(promo).data


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def promotion_list(request):
    if request.method == 'POST':
        serializer = PromotionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        target_type, target_id = data['target_type'], str(data['target_id'])
        if target_type == 'post':
            target = Post.objects.filter(pk=target_id, author=request.user).first() if target_id.isdigit() else None
        else:
            target = Listing.objects.filter(pk=target_id, seller=request.user).first() if target_id.isdigit() else None
        if not target:
            return Response({'detail': 'You can only promote your own content.'}, status=400)
        # Nobody outside the approved followers can see a private account's post,
        # so a promotion there would spend coins on an audience of zero. Say so
        # before the wallet is touched rather than after.
        profile = getattr(request.user, 'profile', None)
        if profile is not None and profile.is_private:
            return Response(
                {'detail': 'A private account cannot promote. Turn off the private switch first.'},
                status=400,
            )
        pack = package_by_id(data.get('package'))
        budget = data.get('budget', 0)
        if pack:
            budget = pack['coins']
        wallet, _ = Wallet.objects.get_or_create(user=request.user)
        try:
            with transaction.atomic():
                if budget > 0:
                    apply(wallet.pk, Transaction.Kind.DEBIT, budget, f'Promotion budget for {target_type}:{target_id}')
                promo = serializer.save(
                    owner=request.user,
                    budget=budget,
                    status=Promotion.Status.ACTIVE,
                    ends_at=timezone.now() + timedelta(days=pack['days']) if pack else None,
                )
        except ValueError as e:
            return Response({'detail': str(e)}, status=400)
        return Response(_row(promo), status=status.HTTP_201_CREATED)
    qs = Promotion.objects.filter(owner=request.user).select_related('owner')
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response([_row(promo) for promo in rows])


@api_view(['POST'])
@permission_classes([IsAuthenticatedOrReadOnly])
def promotion_track(request, pk):
    """Count what a campaign actually did — the only writer of these two counters."""
    promo = Promotion.objects.filter(pk=pk).first()
    if not promo:
        return Response({'detail': 'No such promotion.'}, status=404)
    event = request.data.get('event')
    if event == 'impression':
        Promotion.objects.filter(pk=pk).update(impressions=F('impressions') + 1)
    elif event == 'click':
        Promotion.objects.filter(pk=pk).update(clicks=F('clicks') + 1)
    else:
        return Response({'detail': 'Unknown event.'}, status=400)
    promo.refresh_from_db()
    return Response({'id': promo.pk, 'impressions': promo.impressions, 'clicks': promo.clicks})


@api_view(['GET'])
@permission_classes([IsAdminUser])
def promotion_queue(request):
    qs = Promotion.objects.select_related('owner__profile')
    if request.query_params.get('status'):
        qs = qs.filter(status=request.query_params['status'])
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    data = [_row(promo) for promo in rows]
    for promo, item in zip(rows, data):
        item['owner_card'] = person(promo.owner)
    return paginator.get_paginated_response(data)


EDITABLE = ('category', 'age_min', 'age_max', 'country', 'city')


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def promotion_update(request, pk):
    """Retarget a campaign that is already running.

    The budget is spent at request time, so the package and the coin figure are
    not editable here — the money is already out of the wallet.
    """
    promo = Promotion.objects.filter(pk=pk, owner=request.user).first()
    if not promo:
        return Response({'detail': 'Not your promotion.'}, status=404)
    if promo.status not in (Promotion.Status.ACTIVE, Promotion.Status.PAUSED, Promotion.Status.DRAFT):
        return Response({'detail': 'A finished promotion cannot be edited.'}, status=400)
    fields = []
    for name in EDITABLE:
        if name not in request.data:
            continue
        value = request.data[name]
        if name in ('age_min', 'age_max'):
            try:
                value = int(value)
            except (TypeError, ValueError):
                return Response({'detail': f'{name} must be a number.'}, status=400)
        else:
            value = str(value or '').strip()[:80]
        setattr(promo, name, value)
        fields.append(name)
    if not fields:
        return Response({'detail': 'Nothing to change.'}, status=400)
    if promo.age_min > promo.age_max:
        return Response({'detail': 'age_min cannot exceed age_max.'}, status=400)
    if promo.age_min < 13 or promo.age_max > 100:
        return Response({'detail': 'Age range must sit between 13 and 100.'}, status=400)
    promo.save(update_fields=fields)
    return Response(_row(promo))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def promotion_action(request, pk, action):
    promo = Promotion.objects.filter(pk=pk, owner=request.user).first()
    if not promo:
        return Response({'detail': 'Not your promotion.'}, status=404)
    if action == 'pause' and promo.status == Promotion.Status.ACTIVE:
        promo.status = Promotion.Status.PAUSED
    elif action == 'resume' and promo.status == Promotion.Status.PAUSED:
        promo.status = Promotion.Status.ACTIVE
    elif action == 'end' and promo.status in (Promotion.Status.ACTIVE, Promotion.Status.PAUSED):
        promo.status = Promotion.Status.ENDED
        promo.ends_at = timezone.now()
    else:
        return Response({'detail': 'Invalid transition.'}, status=400)
    promo.save(update_fields=['status', 'ends_at'])
    return Response(_row(promo))
