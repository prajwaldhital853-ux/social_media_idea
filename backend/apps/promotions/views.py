from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from apps.adminpanel import rbac
from apps.common.api import person
from apps.common.config import package_by_id
from apps.common.pagination import KeysetPagination
from apps.common.rules import rate, seat
from apps.marketplace.models import Listing
from apps.posts.models import Post
from apps.wallet.models import Wallet

from . import services
from .models import PromoImpression, Promotion, PromoEvent


CITY_LIMIT = 12


def clean_cities(value):
    """The cities a payer named, in the order they typed them, with the noise out.

    A campaign aimed at `kathmandu , Kathmandu` is one city, not two audiences, and
    the delivery filter compares these strings case-insensitively — so the tidying
    happens once, on the way in, and every reader downstream sees the same list.
    """
    if isinstance(value, str):
        value = value.split(',')
    if not isinstance(value, (list, tuple)):
        return []
    out, seen = [], set()
    for item in value:
        name = str(item or '').strip()[:40]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append(name)
        if len(out) == CITY_LIMIT:
            break
    return out


class PromotionSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = Promotion
        fields = [
            'id', 'owner', 'owner_username', 'target_type', 'target_id', 'category', 'age_min', 'age_max',
            'country', 'cities', 'budget', 'package', 'status', 'impressions', 'clicks', 'profile_visits',
            'messages', 'edited_at', 'created_at', 'starts_at', 'ends_at',
        ]
        read_only_fields = ['id', 'owner', 'status', 'impressions', 'clicks', 'profile_visits', 'messages',
                            'edited_at', 'created_at', 'starts_at', 'ends_at']

    def validate_cities(self, value):
        return clean_cities(value)

    def validate(self, attrs):
        age_min = attrs.get('age_min', 13)
        age_max = attrs.get('age_max', 65)
        if age_min > age_max:
            raise serializers.ValidationError('age_min cannot exceed age_max.')
        if age_min < 13 or age_max > 100:
            raise serializers.ValidationError('Age range must sit between 13 and 100.')
        budget = attrs.get('budget', 0)
        if budget < 0:
            raise serializers.ValidationError('Budget cannot be negative.')
        package_id = attrs.get('package')
        if package_id and not package_by_id(package_id):
            raise serializers.ValidationError('Unknown package.')
        return attrs


def _row(promo):
    return _rows([promo])[0]


def _rows(promos):
    """The campaigns as their payer reads them, with the advert named in words.

    A row alone is `post 431`, which the wallet can only turn into a caption if the
    post happens to be sitting in the page's cache — and it usually is not, so the
    list of things being advertised read as "Post not available". One lookup per page
    carries the line the server already knows, and the client's cache becomes a
    nicer phrasing rather than the only source.
    """
    promos = list(promos)
    labels = services.target_labels(promos)
    # The rates travel with the rows rather than from a second door, so the screen a
    # payer reads is built from the same two ledgers in the same request — and shows
    # the figures as of the moment it was answered.
    figures = services.campaign_figures(promos)
    out = []
    for promo in promos:
        row = PromotionSerializer(promo).data
        row['target_label'] = labels.get((promo.target_type, str(promo.target_id or '')), '')
        row.update(figures.get(promo.pk) or {})
        out.append(row)
    return out


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
        budget = pack['coins'] if pack else data.get('budget', 0)
        wallet, _ = Wallet.objects.get_or_create(user=request.user)
        # The balance is looked at and left alone. A seat's approval is what takes
        # the coins, so a campaign the platform refuses has cost the payer nothing —
        # and a run that never started has no clock to count down.
        if budget > 0 and wallet.balance < Decimal(str(budget)):
            return Response(
                {'detail': f'That package costs {budget} coins and your balance is {wallet.balance}. '
                           'Buy coins first.'},
                status=400,
            )
        promo = serializer.save(
            owner=request.user,
            budget=budget,
            status=Promotion.Status.PENDING,
            starts_at=None,
            ends_at=None,
        )
        return Response(_row(promo), status=status.HTTP_201_CREATED)
    qs = Promotion.objects.filter(owner=request.user).select_related('owner')
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(_rows(rows))


@api_view(['POST'])
@permission_classes([IsAuthenticatedOrReadOnly])
def promotion_track(request, pk):
    """Count a reader who answered a paid card: opened it, or went looking for the payer.

    Neither number is something a caller can report. The feed writes one impression
    row per person per day when it actually puts the card on the screen
    (`services.serving`), and this writes the answer under the same rule — one row
    per person, per campaign, per day, per kind — so the open rate a payer reads is a
    rate between two counts the ledger can be shown to have happened, and a script
    hammering this door moves nothing after the first honest answer.

    Everything that does not qualify is answered with the campaign's real numbers and
    no complaint. A tap from a stranger has no reach row to hang on, a card the run no
    longer serves is not an advert any more, and none of that is the reader's error.
    """
    promo = Promotion.objects.filter(pk=pk).first()
    if not promo:
        return Response({'detail': 'No such promotion.'}, status=404)

    def counted():
        return {
            'id': promo.pk, 'impressions': promo.impressions, 'clicks': promo.clicks,
            'profile_visits': promo.profile_visits, 'messages': promo.messages,
        }

    event = request.data.get('event')
    # A tab built before the ledger was written still reports the impression it used
    # to be allowed to post. It is not wrong, it is just not the source any more.
    if event == 'impression':
        return Response(counted())
    # A reader cannot report the message they sent. Only the chat's own door writes
    # that one, because only that door knows a sentence actually left the composer.
    if event not in (PromoEvent.Kind.CLICK, PromoEvent.Kind.PROFILE):
        return Response({'detail': 'Unknown event.'}, status=400)
    if not request.user.is_authenticated or promo.status != Promotion.Status.ACTIVE:
        return Response(counted())
    if not PromoImpression.objects.filter(promotion=promo, viewer=request.user).exists():
        return Response(counted())
    rate(f'promo-track:{seat(request)}', 'spam_view_per_minute', 60, 120)
    services.answer(request.user, promo, event)
    promo.refresh_from_db()
    return Response(counted())


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('promotions_view')
def promotion_queue(request):
    qs = Promotion.objects.select_related('owner__profile')
    if request.query_params.get('status'):
        qs = qs.filter(status=request.query_params['status'])
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    data = _rows(rows)
    for promo, item in zip(rows, data):
        item['owner_card'] = person(promo.owner)
    return paginator.get_paginated_response(data)


EDITABLE = ('category', 'age_min', 'age_max', 'country', 'cities')


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def promotion_update(request, pk):
    """Retarget a campaign the payer still holds.

    The package and the coin figure are not editable: on an approved run that money
    has already left the wallet, and on a waiting one the desk is reading the price
    it was asked to approve.
    """
    promo = Promotion.objects.filter(pk=pk, owner=request.user).first()
    if not promo:
        return Response({'detail': 'Not your promotion.'}, status=404)
    if promo.status not in (Promotion.Status.ACTIVE, Promotion.Status.PAUSED,
                            Promotion.Status.DRAFT, Promotion.Status.PENDING):
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
        elif name == 'cities':
            value = clean_cities(value)
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
    # The payer's own stamp, and only theirs — a seat's decision has its ledger. This
    # is what explains a run whose numbers change halfway through: the audience moved.
    promo.edited_at = timezone.now()
    promo.save(update_fields=[*fields, 'edited_at'])
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
    elif action == 'end' and promo.status == Promotion.Status.PENDING:
        # Withdrawing an order nobody approved takes back nothing, because it gave
        # up nothing: the coins are still in the payer's wallet and the run never began.
        promo.status = Promotion.Status.ENDED
    elif action == 'end' and promo.status in (Promotion.Status.ACTIVE, Promotion.Status.PAUSED):
        promo.status = Promotion.Status.ENDED
        promo.ends_at = timezone.now()
    else:
        return Response({'detail': 'Invalid transition.'}, status=400)
    promo.save(update_fields=['status', 'ends_at'])
    return Response(_row(promo))
