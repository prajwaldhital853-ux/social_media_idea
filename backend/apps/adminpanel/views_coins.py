"""Contract 6.7 endpoints: the coin queue, the ledger, the pricing desk.

Four gates, not one, because the money a stranger sent and the price a stranger
is quoted are different risks. `coins_view` reads the queue, `coins_review` moves
coins into someone's wallet, `coin_ledger` writes a balance by hand, and
`coin_settings` changes what a Coin costs. An Admin holds all four; a Superadmin
can hand a Moderator the first and refuse the second, which is what a
part-time cashier's seat has to look like.

A payment screenshot never travels in a list response. The queue says a proof
exists; opening it mints a two-minute signed link, and the bytes only come out
for the seat that asked.
"""

import secrets

from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.common.media import save_upload
from apps.common.pagination import KeysetPagination
from apps.common.uploads import EXTENSIONS
from apps.wallet.models import CoinRequest, DeletedWalletRecord, Transaction

from . import coins, rbac, settings_store
from .journal import record
from .models import CoinReview

IMAGE_TYPES = {'image/png', 'image/jpeg', 'image/webp'}
QR_MAX_BYTES = 2 * 1024 * 1024


@api_view(['GET'])
@permission_classes([AllowAny])
def coin_pricing_public(request):
    """What a Coin costs and where the rupees go, a visitor needs this before buying."""
    return Response(coins.pricing())


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coins_view')
def coin_queue(request):
    """The money that has already moved and is waiting on a person."""
    swept = coins.sweep()
    status = request.query_params.get('status')
    qs = CoinRequest.objects.select_related('user', 'user__profile', 'lot')
    if status and status != 'all':
        qs = qs.filter(status=status)
    search = (request.query_params.get('q') or '').strip()
    if search:
        qs = qs.filter(Q(user__username__icontains=search) | Q(reference__icontains=search))

    counts = {
        item['status']: item['n']
        for item in CoinRequest.objects.values('status').annotate(n=Count('id'))
    }
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    held = CoinRequest.objects.filter(status=CoinRequest.Status.PENDING).aggregate(
        coins=Sum('coins'), rupees=Sum('amount'),
    )
    # A pending purchase may already carry an ask, and reading it row by row made
    # the queue cost one query per row. One grouped read covers the page.
    pending = [item.pk for item in rows if item.status == CoinRequest.Status.PENDING]
    last = {}
    if pending:
        for review in (CoinReview.objects.filter(request_id__in=pending).select_related('actor')
                       .order_by('request_id', '-created_at', '-id').distinct('request_id')):
            last[review.request_id] = review
    response = paginator.get_paginated_response([coins.row(item, last.get(item.pk)) for item in rows])
    response.data.update({
        'counts': {
            'pending': counts.get(CoinRequest.Status.PENDING, 0),
            'approved': counts.get(CoinRequest.Status.APPROVED, 0),
            'rejected': counts.get(CoinRequest.Status.REJECTED, 0),
            'refunded': counts.get(CoinRequest.Status.REFUNDED, 0),
            'every': sum(counts.values()),
        },
        'held': {'coins': held['coins'] or 0, 'rupees': str(held['rupees'] or 0)},
        'proofs_deleted': swept['cleared'],
        'retention_days': swept['days'],
        'can_review': rbac.can(request.staff_account, 'coins_review'),
        'pricing': coins.pricing(),
    })
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coins_view')
def coin_detail(request, pk):
    req = coins.find_request(pk)
    if req is None:
        return Response({'detail': 'No coin request with that id.'}, status=404)
    # The decision travels with the row even after it leaves the queue. A seat that
    # reopens a settled purchase to check who credited it has to be told, because
    # "nobody signed this off" is the most damaging wrong answer this screen can give.
    return Response({'request': coins.row(req, coins.latest(req.pk)), 'asks': coins.asks(req.pk)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coins_review')
def coin_decide(request, pk, action):
    req = coins.find_request(pk)
    if req is None:
        return Response({'detail': 'No coin request with that id.'}, status=404)
    # `paid` is not a verdict on an open purchase. It closes a refund the buyer asked
    # for on one that was already approved, so it meets its own door and its own rules.
    if action == 'paid':
        code, body = coins.settle(req, request.user, request.data.get('reason', ''))
        return Response(body, status=code)
    code, body = coins.decide(req, request.user, action, request.data.get('reason', ''))
    return Response(body, status=code)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coins_view')
def coin_proof_link(request, pk):
    """Mint the short-lived link, then the console points an image at it.

    `?for=refund` mints the picture the buyer attached to a refund ask instead of the
    payment receipt, so neither one is ever handed out as a URL that outlives the click.
    """
    req = CoinRequest.objects.filter(pk=pk).first()
    if req is None:
        return Response({'detail': 'No coin request with that id.'}, status=404)
    which = 'refund' if request.query_params.get('for') == 'refund' else 'payment'
    if not coins._proof_url(req, which):
        return Response({'detail': f'There is no {which} screenshot on this request.'}, status=404)
    token = coins.proof_token(req, request.user, which)
    return Response({
        'href': f'/api/admin/coins/{pk}/receipt/?t={token}',
        'expires_in': coins.PROOF_TTL,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coins_view')
def coin_proof(request, pk, t=None):
    """The bytes themselves, only for the link that was just minted.

    The session check is not enough on its own: a proof URL that stays valid
    forever ends up in a browser history, and a seat that was switched off should
    not be able to open a link it was handed while it still had the pen.
    """
    token = t or request.query_params.get('t')
    if not token:
        return Response({'detail': 'That proof has to be opened through a link from the queue.'}, status=400)
    req = CoinRequest.objects.filter(pk=pk).first()
    if req is None:
        return Response({'detail': 'No coin request with that id.'}, status=404)
    response, error = coins.proof_file(req, request.user.pk, token)
    if error is not None:
        body, status = error
        return Response({'detail': body}, status=status)
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coin_ledger')
def coin_ledger(request):
    """The wallet's own history, which this console can only ever add to."""
    qs = Transaction.objects.select_related('wallet', 'wallet__user', 'wallet__user__profile')
    search = (request.query_params.get('q') or '').strip()
    if search:
        qs = qs.filter(wallet__user__username__icontains=search)
    kind = request.query_params.get('kind')
    if kind in (Transaction.Kind.CREDIT, Transaction.Kind.DEBIT):
        qs = qs.filter(kind=kind)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    totals = Transaction.objects.aggregate(credited=Sum('amount', filter=Q(kind='credit')),
                                           debited=Sum('amount', filter=Q(kind='debit')))
    response = paginator.get_paginated_response([coins.entry_row(item) for item in rows])
    # A deleted account is not in any wallet any more, but its money record is.
    # Searching the desk for its username is how a seat settles a dispute about
    # money that moved before the account went.
    archived = None
    if search:
        gone = DeletedWalletRecord.objects.filter(username__iexact=search).first()
        if gone:
            record_data = gone.record
            archived = {
                'username': gone.username,
                'archived_at': gone.archived_at.isoformat(),
                'counts': {
                    'movements': len(record_data.get('movements', [])),
                    'requests': len(record_data.get('requests', [])),
                    'campaigns': len(record_data.get('campaigns', [])),
                },
                'record': record_data,
            }
    response.data.update({
        'deleted': archived,
        'totals': {
            'credited': str(totals['credited'] or 0),
            'debited': str(totals['debited'] or 0),
            'entries': Transaction.objects.count(),
        },
        # One grouped read, keyed by the words the chips filter with.
        'counts': {move['kind']: move['n'] for move in
                   Transaction.objects.values('kind').annotate(n=Count('pk'))},
    })
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coin_ledger')
def ledger_suggest(request):
    """The accounts a hand-written row could name, as the seat types the name.

    The adjust form demands an exact username, and a typo on a money row is the
    kind of mistake nobody can edit away, so the field offers the real accounts
    instead of asking the seat to spell one from memory.
    """
    query = (request.query_params.get('q') or '').strip()
    if not query:
        return Response({'results': []})
    rows = (get_user_model().objects
            .filter(username__icontains=query)
            .select_related('wallet', 'profile')
            .order_by('username')[:6])
    return Response({'results': [
        {
            'username': row.username,
            'name': row.profile.display_name or row.get_full_name() or row.username,
            'avatar': row.profile.avatar_url,
            'balance': str(row.wallet.balance) if getattr(row, 'wallet', None) else '0',
        }
        for row in rows
    ]})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coin_ledger')
def coin_adjust(request):
    code, body = coins.adjust(
        request.user,
        str(request.data.get('username') or '').strip(),
        str(request.data.get('direction') or ''),
        request.data.get('amount'),
        request.data.get('reason', ''),
    )
    return Response(body, status=code)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coin_settings')
def coin_desk(request):
    """The pricing desk: what a Coin costs, the floor, where the money goes, how long proofs live."""
    if request.method == 'GET':
        return Response({
            'lines': coins.settings_lines('payments'),
            'pricing': coins.pricing(),
            'counts': {'held': CoinRequest.objects.filter(status=CoinRequest.Status.PENDING).count()},
        })
    code, body, moved = coins.write_pricing(request.user, request.data)
    if code != 200:
        return Response(body, status=code)
    return Response({
        'lines': coins.settings_lines('payments'),
        'pricing': coins.pricing(),
        'detail': f'Saved {", ".join(label.lower() for label in moved)}. The site quotes the new '
                  'numbers on the next pricing call; nothing has to be deployed.',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('coin_settings')
def coin_qr_upload(request):
    """The payment QR the payer scans, kept out of the ordinary upload folder.

    A QR is an account number drawn as a picture: whoever can replace it can
    redirect the platform's income, so it is only ever written by a seat holding
    the pricing key, into its own folder, and the swap is audited.
    """
    upload = request.FILES.get('file')
    if upload is None:
        return Response({'detail': 'No image received.'}, status=400)
    if (upload.content_type or '') not in IMAGE_TYPES:
        return Response({'detail': 'The payment QR has to be a PNG, JPEG or WebP image.'}, status=400)
    if upload.size > QR_MAX_BYTES:
        return Response({'detail': 'A payment QR is a small drawing; keep it under 2 MB.'}, status=400)
    extension = EXTENSIONS[upload.content_type]
    name = f'coin-qr/{secrets.token_hex(8)}{extension}'.lower()
    path = save_upload(name, upload)
    url = request.build_absolute_uri(f'{django_settings.MEDIA_URL}{path}')
    previous = str(settings_store.get('coin_qr_url') or '')
    settings_store.write(request.user, {'coin_qr_url': url})
    record(request.user, 'coin_qr', 'payment QR',
           'Put the first payment QR code up.' if not previous
           else f'Replaced the payment QR code ({_name_of(previous)} → {_name_of(url)}).')
    return Response({
        'lines': coins.settings_lines('payments'),
        'pricing': coins.pricing(),
        'detail': 'The payment QR is live. Anyone who has already been shown the old picture still '
                  'has it, so a bank change is worth telling people about.',
    })


def _name_of(url):
    return url.rstrip('/').split('/')[-1] or 'nothing'
