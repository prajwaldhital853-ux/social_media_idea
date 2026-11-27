"""Contract 6.8 endpoints: the promotion queue, the packages and the reach dials.

Three keys, because the three powers are not the same risk. `promotions_view` reads
who paid for reach and what their campaign points at. `promotions_review` decides ,
and a refusal moves real coins back into somebody's wallet, which is the one thing
in this console that cannot be taken back by reloading. `promotion_packages` and
`promotion_algorithm` change what the *next* payer is sold and how the feed spends
it, which affects everyone at once and nobody in particular.

The queue carries the thing itself, not just its id: a decision about a paid campaign
is made by looking at the post, the audience it targets and the reports already
sitting on it. That preview is composed here from the member site's own rows,
read-only, through the same helper the report queue uses.
"""

from decimal import Decimal

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.common.api import person
from apps.common.pagination import KeysetPagination
from apps.moderation.models import Report
from apps.promotions.models import Promotion
from apps.promotions.services import campaign_figures

from . import promotions, rbac, review
from .models import PromoReview

SIGNED = (PromoReview.Action.APPROVE, PromoReview.Action.RESUME)
STATES = ('waiting', 'live', 'paused', 'refused', 'ended', 'all')
LIVE = (Promotion.Status.ACTIVE, Promotion.Status.PAUSED)


def _signed_ids():
    return set(PromoReview.objects.filter(action__in=SIGNED).values_list('promotion_id', flat=True))


def _base():
    return Promotion.objects.select_related('owner', 'owner__profile')


def _waiting():
    """The rows a seat has to look at: orders nothing has charged yet, plus a running
    campaign nobody signed off, the ones the old rule let straight into the feed."""
    return (Q(status=Promotion.Status.PENDING)
            | (Q(status=Promotion.Status.ACTIVE) & ~Q(pk__in=_signed_ids())))


def _counts():
    """How many campaigns sit in each part of the desk, and what they hold back."""
    signed = _signed_ids()
    active = Promotion.objects.filter(status=Promotion.Status.ACTIVE)
    by_state = dict(Promotion.objects.values('status').annotate(n=Count('id')).values_list('status', 'n'))
    reserved = sum((promo.budget for promo in Promotion.objects.filter(status__in=LIVE)), Decimal('0'))
    # The coins an approved-but-not-yet-charged order would take. Saying "reserved"
    # about these would be a lie: they are still in the payer's wallet.
    unbilled = sum((promo.budget for promo in Promotion.objects.filter(
        status=Promotion.Status.PENDING)), Decimal('0'))
    return {
        'waiting': Promotion.objects.filter(_waiting()).count(),
        'orders': by_state.get(Promotion.Status.PENDING, 0),
        'live': active.filter(pk__in=signed).count(),
        'paused': by_state.get(Promotion.Status.PAUSED, 0),
        'refused': by_state.get(Promotion.Status.REJECTED, 0),
        'ended': by_state.get(Promotion.Status.ENDED, 0),
        'every': Promotion.objects.count(),
        'reserved': str(reserved),
        'unbilled': str(unbilled),
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def promotion_config(request):
    """What the member site needs to honour the dials: weights, caps, pause, packages.

    Open on purpose. A feed cannot rank posts against a threshold it is not allowed
    to read, and nothing in here is a person's data, it is the shape of the ranking.
    """
    return Response(promotions.public_config())


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('promotions_view')
def promotion_queue(request):
    """The campaigns, split the way a person at the desk splits them."""
    state = request.query_params.get('state') or 'waiting'
    if state not in STATES:
        return Response({'detail': f'Pick one of: {", ".join(STATES)}.'}, status=400)
    qs = _base()
    signed = _signed_ids()
    if state == 'waiting':
        qs = qs.filter(Q(status=Promotion.Status.PENDING)
                       | (Q(status=Promotion.Status.ACTIVE) & ~Q(pk__in=signed)))
    elif state == 'live':
        qs = qs.filter(status=Promotion.Status.ACTIVE, pk__in=signed)
    elif state == 'refused':
        qs = qs.filter(status=Promotion.Status.REJECTED)
    elif state != 'all':
        qs = qs.filter(status=state)

    search = (request.query_params.get('q') or '').strip()
    if search:
        qs = qs.filter(Q(owner__username__icontains=search) | Q(target_id__icontains=search)
                       | Q(category__icontains=search) | Q(package__icontains=search))

    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    last = {}
    for item in PromoReview.objects.filter(promotion__in=[row.pk for row in rows]).order_by(
            'promotion', '-created_at', '-id'):
        last.setdefault(item.promotion_id, item)
    tuned = promotions.algorithm()
    # One figures read for the whole page: the ranking inside it looks at every
    # campaign on the platform, which a row at a time would make forty scans of the
    # same table on a queue page.
    figures = campaign_figures(rows)
    response = paginator.get_paginated_response(
        [promotions.row(item, last.get(item.pk), deep=True, figures=figures.get(item.pk)) for item in rows])
    response.data.update({
        'counts': _counts(),
        'state': state,
        'can_review': rbac.can(request.staff_account, 'promotions_review'),
        'controls': {'caps': tuned['caps'], 'floor': tuned['floor'], 'global_pause': tuned['global_pause']},
        'packages': tuned['packages'],
    })
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('promotions_view')
def promotion_detail(request, pk):
    """One campaign, every decision it has had, and the reports underneath it."""
    promo = _base().filter(pk=pk).first()
    if promo is None:
        return Response({'detail': 'No campaign with that id.'}, status=404)
    target = promotions.target_of(promo)
    reports = [{
        # The id and the sentence the person typed travel with the reason: a seat
        # that refuses a campaign has to be able to say which report its decision
        # answers, and "there were three reports" is not something anybody can quote.
        'id': item.pk,
        'reporter': person(item.reporter), 'reason': item.reason, 'details': item.details,
        'status': item.status, 'created_at': item.created_at.isoformat(),
    } for item in Report.objects.filter(target_type=promo.target_type, target_id=str(promo.target_id))
        .select_related('reporter', 'reporter__profile').order_by('-created_at')[:12]]
    return Response({
        'campaign': promotions.row(promo, deep=True),
        'reviews': promotions.reviews(promo.pk),
        'reports': reports,
        'target_state': review.state_of(promo.target_type, target) if target is not None else 'gone',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('promotions_review')
def promotion_decide(request, pk, action):
    """Approve, refuse, pause, resume or stop, the only verbs that move coins."""
    promo = _base().filter(pk=pk).first()
    if promo is None:
        return Response({'detail': 'No campaign with that id.'}, status=404)
    code, body = promotions.decide(
        promo, request.user, action,
        reason=request.data.get('reason', ''),
        # Deliberately not defaulted to `credit`: on a stop the seat has to say
        # whether the unrun part of the budget goes back or is withheld, and a
        # silent default would decide that for the payer.
        choice=str(request.data.get('refund') or ''),
    )
    return Response(body, status=code)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('promotion_packages')
def package_desk(request):
    """The three things a package is made of: a price, a run, a reach promise."""
    if request.method == 'GET':
        bought = dict(Promotion.objects.values('package').annotate(n=Count('id')).values_list('package', 'n'))
        return Response({
            'packages': promotions.packages(),
            'shipped': promotions.shipped(),
            'is_edited': promotions.is_edited(),
            'bought': bought,
            'detail': 'These are what a payer chooses from. A campaign already running keeps the '
                      'package it was bought with.',
        })
    code, body = promotions.write_packages(request.user, request.data.get('packages'))
    return Response(body, status=code)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('promotion_algorithm')
def algorithm_desk(request):
    """The ranking dials, the caps, and the one switch that stops paid reach entirely."""
    if request.method == 'GET':
        tuned = promotions.algorithm()
        return Response({
            **tuned,
            'running': Promotion.objects.filter(status=Promotion.Status.ACTIVE).count(),
            'started_today': Promotion.objects.filter(created_at__date=timezone.now().date()).count(),
        })
    code, body = promotions.write_algorithm(request.user, request.data)
    return Response(body, status=code)
