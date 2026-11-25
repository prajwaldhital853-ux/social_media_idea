"""Contract 6.9: the spam desk, and the two lists the pile produces.

Three doors, because three different questions are asked here. The desk changes a
rule that applies to everybody at once, how often one person may act, what a
day-old account may not do, how many reporters pull a post out of the feed, which
is why a Moderator does not hold `spam_settings` by default. The open door publishes
those same rules for the member site to honour, and the desk prints what it answers
so a seat never has to believe a save banner.

`flagged` is the third question, and it is asked from the other end of a queue a
moderator already works: not "what has been filed" but "what has already been pulled,
by how many people, and who it was pulled from". The blocked-link list is written
through the platform-rules doors (`/api/admin/policy/terms/` with `kind=link`), so a
word, a prohibited item and a domain stay one table with one audit verb.
"""

from django.db.models import Count, Max
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.moderation.models import Report

from . import people, rbac, spam
from .models import PolicyTerm

OPEN_STATES = (Report.Status.OPEN, Report.Status.REVIEWING)
MODELS = people.CONTENT_MODELS
LIVE = people.LIVE_STATES
OWNER = people.OWNER_FIELD
KIND_LABEL = {'post': 'post', 'comment': 'comment', 'listing': 'listing'}


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('spam_settings')
def spam_desk(request):
    """Rate limits, new-account rules, the pile that pulls content, blocked links."""
    if request.method == 'GET':
        return Response(spam.desk(request.staff_account))
    code, body = spam.write(request.user, request.data)
    return Response(body, status=code)


@api_view(['GET'])
@permission_classes([AllowAny])
def spam_config(request):
    """What the member site needs to honour the desk. Open, and holds no person's data.

    A rate limit a view cannot read before it refuses a request is a number written
    in a screen and nothing else, so the desk publishes it here the moment it is
    saved, the same door the reach controls are published behind.
    """
    return Response(spam.public_config())


def _piled(limit, offset=0, size=40):
    """(kind, target) with at least `limit` distinct open reporters, worst first."""
    return list(
        Report.objects.filter(status__in=OPEN_STATES, target_type__in=list(MODELS))
        .values('target_type', 'target_id')
        .annotate(reporters=Count('reporter', distinct=True), reports=Count('pk'), newest=Max('created_at'))
        .filter(reporters__gte=limit)
        .order_by('-reporters', '-newest')[offset:offset + size]
    )


def _reasons(piled):
    """The top reasons named against each target, in one grouped query."""
    keys = {(item['target_type'], item['target_id']) for item in piled}
    grouped = (
        Report.objects.filter(status__in=OPEN_STATES)
        .values('target_type', 'target_id', 'reason').annotate(n=Count('pk'))
    )
    out = {}
    for item in grouped:
        key = (item['target_type'], item['target_id'])
        if key not in keys:
            continue
        out.setdefault(key, []).append({'reason': item['reason'], 'n': item['n']})
    return {key: sorted(value, key=lambda row: -row['n'])[:3] for key, value in out.items()}


def _rows(piled, reasons):
    by_kind = {}
    for item in piled:
        if str(item['target_id']).isdigit():
            by_kind.setdefault(item['target_type'], []).append(int(item['target_id']))
    found = {}
    for kind, ids in by_kind.items():
        for obj in MODELS[kind].objects.select_related(OWNER[kind]).filter(pk__in=ids):
            found[(kind, str(obj.pk))] = obj
    rows = []
    for item in piled:
        key = (item['target_type'], item['target_id'])
        obj = found.get(key)
        if obj is None:
            # The reporter is still counting, but the row they pointed at is gone ,
            # a deleted post keeps its reports. It stays on the list because the
            # pile is what it is; the screen just has no owner or state to show.
            rows.append({
                'kind': item['target_type'], 'label': KIND_LABEL.get(item['target_type'], ''),
                'id': item['target_id'], 'state': 'gone', 'live': False, 'gone': True,
                'owner': None, 'reporters': item['reporters'], 'reports': item['reports'],
                'newest': item['newest'], 'reasons': reasons.get(key, []),
            })
            continue
        live = obj.status == LIVE[item['target_type']]
        rows.append({
            'kind': item['target_type'],
            'label': KIND_LABEL.get(item['target_type'], item['target_type']),
            'id': obj.pk,
            'state': obj.status,
            # `held` is the sentence a seat acts on: the pile was big enough that the
            # platform already took this out of the feed, so nobody is waiting on them.
            'live': live, 'gone': False,
            'state_word': 'in the feed' if live else 'held',
            'owner': people.person(obj.__getattribute__(OWNER[item['target_type']])),
            'reporters': item['reporters'],
            'reports': item['reports'],
            'newest': item['newest'],
            'reasons': reasons.get(key, []),
        })
    return rows


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def flagged(request):
    """Flagged content and flagged accounts, the two lists the pile produces."""
    limit = spam.report_threshold()
    page = 0
    try:
        page = max(0, int(request.query_params.get('page') or 0))
    except ValueError:
        page = 0
    piled = _piled(limit, page * 40)
    reasons = _reasons(piled)
    accounts = people.directory(state='flagged')
    return Response({
        'generated_at': timezone.now(),
        'threshold': limit,
        'content': _rows(piled, reasons),
        'content_page': page,
        'content_more': len(piled) == 40,
        'accounts': people.rows(list(accounts[:40])),
        'accounts_total': accounts.count(),
        'words': PolicyTerm.objects.filter(kind=PolicyTerm.Kind.WORD, is_active=True).count(),
        'links': len(spam.blocked_links()),
        'can_review': rbac.can(request.staff_account, 'content'),
    })
