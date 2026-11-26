"""Contract 6.3 endpoints: the report queue, the takedown shelf, the policy lists, the notices.

The gates are per target rather than per screen. `reports` opens the queue,
because reading what people reported is the moderator's job; but deciding a
listing also needs `listings` and deciding a post also needs `content`, so a
seat that was hired for the marketplace cannot talk its way into taking a photo
down. The verbs themselves live in `review.py`, which is also where one decision
clears the whole pile and cancels whatever campaign was running on the content.
"""

from django.db.models import Count, Q
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.comments.models import Comment
from apps.common.api import person
from apps.common.pagination import KeysetPagination
from apps.marketplace.models import Listing
from apps.moderation.models import AuditLog, Report
from apps.posts.models import Post

from . import policy, rbac, review, spam
from .journal import record
from .models import PolicyCategory, PolicyTerm, PublicNotice

SHELF_MODELS = {'post': Post, 'comment': Comment, 'listing': Listing}

# What a seat is allowed to say when it is looking for a thing. An id is not on
# this list: nobody is handed the number at the end of an address bar, so a
# moderator has the words of the post and the name of whoever wrote it, and a
# name is worth searching even when it is spelled only partly right.
WHO = ('{who}__username', '{who}__email', '{who}__first_name',
       '{who}__last_name', '{who}__profile__display_name')
SEARCH_FIELDS = {
    'post': ('text',) + tuple(field.format(who='author') for field in WHO),
    'comment': ('text', 'post__text') + tuple(field.format(who='author') for field in WHO),
    'listing': ('title', 'description') + tuple(field.format(who='seller') for field in WHO),
}


def _accounts_named(query):
    """Every account whose username, email or name carries the word."""
    return User.objects.filter(
        Q(username__icontains=query) | Q(email__icontains=query)
        | Q(first_name__icontains=query) | Q(last_name__icontains=query)
        | Q(profile__display_name__icontains=query)
    ).values_list('pk', flat=True)[:200]


def _named(query):
    """The reports one word points at, the reporter's, or about the thing named.

    The queue is a list of reports, so searching it for a person means first
    finding what that person wrote and then the reports sitting on it. A word
    that matches nothing returns nothing, which is the honest answer.
    """
    found = (
        Q(reporter__username__icontains=query) | Q(reporter__email__icontains=query)
        | Q(reason__icontains=query) | Q(details__icontains=query)
    )
    for kind, fields in SEARCH_FIELDS.items():
        condition = Q()
        for field in fields:
            condition |= Q(**{f'{field}__icontains': query})
        pks = list(SHELF_MODELS[kind].objects.filter(condition).values_list('pk', flat=True)[:200])
        found |= Q(target_type=kind, target_id__in=[str(pk) for pk in pks])
    return found | Q(target_type='user', target_id__in=[str(pk) for pk in _accounts_named(query)])



def _held(request, key):
    """None when the seat may go on, otherwise the 403 naming what is missing."""
    if not key or rbac.can(request.staff_account, key):
        return None
    label = rbac.LABELS.get(key, key)
    return rbac.denial('permission_required', f'{label} is not on your seat.', permission=key, label=label)


def _report_row(report, terms):
    kind = report.target_type
    row = review.row_for(kind, report.target_id)
    content = review.preview(kind, row)
    haystack = f"{(content or {}).get('text') or ''} {(content or {}).get('title') or ''}"
    return {
        'id': report.pk,
        'target': f'{kind}:{report.target_id}',
        'target_type': kind,
        'target_id': str(report.target_id),
        'reason': report.reason,
        'details': report.details,
        'status': report.status,
        'created_at': report.created_at,
        'resolved_at': report.resolved_at,
        'reporter': person(report.reporter),
        'missing': row is None,
        'content': content,
        'pile': review.pile(kind, report.target_id),
        'matches': review.match(haystack, terms),
        'campaigns': review.campaigns_on(kind, report.target_id).count(),
        'permission': review.KEY_BY_KIND.get(kind),
        # A target that has since been deleted has nothing for any verb to act
        # on, so the row says so by offering none instead of three 400s.
        'actions': [] if row is None else review.actions_for(kind, content['state']),
    }


def _facets():
    opened = Report.objects.filter(status__in=review.OPEN_STATES)
    return {
        'open': opened.count(),
        # Every chip on the queue carries its own number, so a seat can see the
        # size of the answered piles without clicking into each one.
        'resolved': Report.objects.filter(status=Report.Status.RESOLVED).count(),
        'dismissed': Report.objects.filter(status=Report.Status.DISMISSED).count(),
        'all': Report.objects.count(),
        'by_target': {kind: opened.filter(target_type=kind).count() for kind in review.KINDS},
        # The number of distinct reporters that pull a piece of content out of the
        # feed on its own, so the queue can say "hidden at 1" instead of guessing.
        'auto_hide_at': spam.report_threshold(),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def review_queue(request):
    """The reports a seat has to decide, newest first, with the thing itself attached."""
    kind = (request.query_params.get('target') or '').strip()
    if kind not in ('', 'all') + review.KINDS:
        return Response({'detail': 'Choose post, comment, listing or user.'}, status=400)
    state = (request.query_params.get('status') or 'open').strip()
    rows = Report.objects.select_related('reporter', 'reporter__profile')
    if kind and kind != 'all':
        rows = rows.filter(target_type=kind)
    if state == 'open':
        rows = rows.filter(status__in=review.OPEN_STATES)
    elif state == 'all':
        pass
    elif state in dict(Report.Status.choices):
        rows = rows.filter(status=state)
    else:
        return Response({'detail': 'Choose open, resolved, dismissed or all.'}, status=400)
    query = (request.query_params.get('q') or '').strip()
    if query:
        rows = rows.filter(_named(query))

    terms = policy.words()
    listing_terms = terms + policy.items()
    paginator = KeysetPagination()
    page = paginator.paginate_queryset(rows, request)
    response = paginator.get_paginated_response([
        _report_row(report, listing_terms if report.target_type == 'listing' else terms)
        for report in page
    ])
    response.data['facets'] = _facets()
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def review_case(request):
    """One target opened as a page: the thing, every report on it, everything done to it.

    The queue groups by target because a seat decides about a post, not about a
    report. This is what that group looks like unfolded, the same rows the queue
    builds, unpaginated, because a target has as many reports against it as people
    have bothered to file and no more. Both desks land here, so the takedown shelf
    and the report queue are two ways of reaching one page rather than two pages
    that disagree about what the content says.
    """
    target = str(request.query_params.get('target') or '').strip().lower()
    kind, _, raw_id = target.partition(':')
    if kind not in review.MODEL:
        return Response({'detail': 'Name the thing as post:17, comment:17, listing:17 or user:17.'}, status=400)
    pk = review.pk_of(raw_id)
    if pk is None:
        return Response({'detail': f'{raw_id or "Nothing"} is not a number.'}, status=400)

    row = review.row_for(kind, pk)
    content = review.preview(kind, row) if row is not None else None
    reports = Report.objects.filter(
        target_type=kind, target_id=str(pk),
    ).select_related('reporter', 'reporter__profile').order_by('-created_at')
    terms = policy.terms_for(kind)
    haystack = f"{(content or {}).get('text') or ''} {(content or {}).get('title') or ''}"
    decided = AuditLog.objects.filter(
        target=f'{kind}:{pk}', action__in=set(review.AUDIT.values()) | {'attach_notice', 'withdraw_notice'},
    ).select_related('actor').order_by('-created_at')[:20]
    return Response({
        'target': f'{kind}:{pk}',
        'kind': kind,
        'id': pk,
        'missing': row is None,
        'content': content,
        'matches': review.match(haystack, terms),
        'pile': review.pile(kind, pk),
        'campaigns': review.campaigns_on(kind, pk).count(),
        'permission': review.KEY_BY_KIND.get(kind),
        'actions': [] if row is None else review.actions_for(kind, content['state']),
        'reports': [{
            'id': report.pk,
            'reason': report.reason,
            'details': report.details,
            'status': report.status,
            'created_at': report.created_at,
            'resolved_at': report.resolved_at,
            'reporter': person(report.reporter),
        } for report in reports],
        'notices': [review.notice_row(notice) for notice in PublicNotice.objects.filter(
            target_type=kind, target_id=str(pk),
        ).select_related('about', 'actor').order_by('-created_at')],
        'history': [{
            'id': entry.pk,
            'action': entry.action,
            'actor': entry.actor.username if entry.actor else None,
            'at': entry.created_at,
            'detail': entry.detail,
        } for entry in decided],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def review_decide(request, pk):
    """One verb against one report, applied to the target and its whole pile."""
    report = Report.objects.filter(pk=pk).first()
    if report is None:
        return Response({'detail': 'No such report.'}, status=404)
    kind = report.target_type
    denied = _held(request, review.KEY_BY_KIND.get(kind))
    if denied is not None:
        return denied
    action = str(request.data.get('action') or '').strip()
    if action not in review.ACTIONS:
        return Response({'detail': 'Choose dismiss, remove, warn, release or restore.'}, status=400)
    try:
        out = review.decide(
            report, request.user, action,
            reason=request.data.get('reason') or '',
            notice_text=request.data.get('notice') or '',
            audience=request.data.get('audience') or '',
        )
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=400)
    out['pile'] = review.pile(kind, report.target_id)
    out['facets'] = _facets()
    return Response(out)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def content_shelf(request):
    """What is off the feed right now, with the sentence that took it down.

    The queue only ever shows reported things. This is the other half of the
    contract, the post removed last month that nobody has reported since, which
    is the one a person asks to have restored.
    """
    kind = (request.query_params.get('type') or 'post').strip()
    model = SHELF_MODELS.get(kind)
    if model is None:
        return Response({'detail': 'Choose post, comment or listing.'}, status=400)
    denied = _held(request, review.KEY_BY_KIND.get(kind))
    if denied is not None:
        return denied

    hidden, removed = review.HIDDEN_STATE.get(kind), review.REMOVED_STATE[kind]
    state = (request.query_params.get('state') or 'taken_down').strip()
    if state == 'hidden' and hidden:
        rows = model.objects.filter(status=hidden)
    elif state == 'removed':
        rows = model.objects.filter(status=removed)
    elif state == 'taken_down':
        rows = model.objects.filter(status__in=[value for value in (hidden, removed) if value])
    elif state == 'live':
        rows = model.objects.filter(status=review.LIVE_STATE[kind])
    elif state == 'all':
        rows = model.objects.all()
    else:
        return Response({'detail': 'Choose hidden, removed, live or all.'}, status=400)

    query = (request.query_params.get('q') or '').strip()
    if query:
        condition = Q()
        for field in SEARCH_FIELDS[kind]:
            condition |= Q(**{f'{field}__icontains': query})
        rows = rows.filter(condition)

    rows = rows.select_related('author__profile') if kind in ('post', 'comment') else rows.select_related('seller__profile')
    if kind == 'comment':
        rows = rows.select_related('post__author')
    paginator = KeysetPagination()
    page = paginator.paginate_queryset(rows, request)

    terms = policy.terms_for(kind)
    targets = [f'{kind}:{row.pk}' for row in page]
    decisions = {}
    for entry in AuditLog.objects.filter(
        target__in=targets, action__in=set(review.AUDIT.values()),
    ).select_related('actor').order_by('-created_at'):
        # Newest first, so the first row seen for a target is the last thing done.
        decisions.setdefault(entry.target, entry)

    data = []
    for row in page:
        content = review.preview(kind, row)
        haystack = f"{content.get('text') or ''} {content.get('title') or ''}"
        entry = decisions.get(f'{kind}:{row.pk}')
        data.append({
            'target': f'{kind}:{row.pk}',
            'content': content,
            'matches': review.match(haystack, terms),
            'campaigns': review.campaigns_on(kind, row.pk).count(),
            'pile': review.pile(kind, row.pk),
            'permission': review.KEY_BY_KIND.get(kind),
            'actions': review.actions_for(kind, content['state']),
            'decision': None if entry is None else {
                'action': entry.action,
                'actor': entry.actor.username if entry.actor else None,
                'at': entry.created_at,
                'detail': entry.detail,
            },
        })
    response = paginator.get_paginated_response(data)
    # The shelf's chips are named by what a seat is looking for, not by the raw
    # status column, so the numbers come back under the same words the chips use.
    by_status = {row['status']: row['n'] for row in model.objects.values('status').annotate(n=Count('pk'))}
    hidden_n = by_status.get(hidden, 0) if hidden else 0
    removed_n = by_status.get(removed, 0)
    response.data['counts'] = {
        'taken_down': hidden_n + removed_n,
        'hidden': hidden_n,
        'removed': removed_n,
        'live': by_status.get(review.LIVE_STATE[kind], 0),
        'all': sum(by_status.values()),
    }
    response.data['type'] = kind
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def content_action(request, kind, pk):
    """The same five verbs, from the shelf, with no report to hang them on."""
    if kind not in SHELF_MODELS:
        return Response({'detail': 'Choose post, comment or listing.'}, status=400)
    denied = _held(request, review.KEY_BY_KIND.get(kind))
    if denied is not None:
        return denied
    action = str(request.data.get('action') or '').strip()
    if action not in review.ACTIONS:
        return Response({'detail': 'Choose dismiss, remove, warn, release or restore.'}, status=400)
    try:
        out = review.act(
            kind, pk, request.user, action,
            reason=request.data.get('reason') or '',
            notice_text=request.data.get('notice') or '',
            audience=request.data.get('audience') or '',
        )
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=400)
    return Response(out)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def policy_lists(request):
    """The words, the things and the shelf labels a decision is made against.

    Reading this needs only the queue: a moderator who cannot change the list
    still has to be able to see what the platform has said is not allowed.
    """
    # `Listing.category` is free text, so the same shelf label reaches this count
    # spelled several ways; counting it case-insensitively is what tells an admin
    # what switching a label off actually costs.
    on_shelf = dict(
        Listing.objects.filter(status=Listing.Status.ACTIVE)
        .annotate(label=Lower('category')).values('label').annotate(n=Count('pk'))
        .values_list('label', 'n')
    )
    return Response({
        'terms': [policy.row_term(term) for term in PolicyTerm.objects.select_related('created_by')],
        'categories': [
            policy.row_category(category, on_shelf.get(category.name.lower(), 0))
            for category in PolicyCategory.objects.all()
        ],
        'auto_hide_at': _facets()['auto_hide_at'],
    })


def _term_write(request, pk=None):
    """Create or edit one blocked word or prohibited item."""
    data = request.data
    term = PolicyTerm.objects.filter(pk=pk).first() if pk else None
    if pk and term is None:
        return Response({'detail': 'No such entry on the list.'}, status=404)

    if term is None:
        kind = str(data.get('kind') or PolicyTerm.Kind.WORD).strip()
        if kind not in dict(PolicyTerm.Kind.choices):
            return Response({'detail': 'Choose a blocked word, a prohibited item or a blocked link.'}, status=400)
        text = policy.normalize(data.get('text'))
        if not text:
            return Response({'detail': 'Write the word or the thing.'}, status=400)
        if len(text) > 80:
            return Response({'detail': 'Keep it under 80 characters.'}, status=400)
        if PolicyTerm.objects.filter(kind=kind, text=text).exists():
            return Response({'detail': f'“{text}” is already on that list.'}, status=400)
        term = PolicyTerm.objects.create(
            kind=kind, text=text, note=str(data.get('note') or '')[:200],
            is_active=bool(data.get('is_active', True)), created_by=request.user,
        )
        record(request.user, 'policy_term', f'{kind}:{text}', 'added to the list')
        return Response(policy.row_term(term), status=201)

    fields = []
    if 'text' in data:
        text = policy.normalize(data.get('text'))
        if not text or len(text) > 80:
            return Response({'detail': 'A list entry is between 1 and 80 characters.'}, status=400)
        if PolicyTerm.objects.filter(kind=term.kind, text=text).exclude(pk=term.pk).exists():
            return Response({'detail': f'“{text}” is already on that list.'}, status=400)
        term.text = text
        fields.append('text')
    if 'note' in data:
        term.note = str(data.get('note') or '')[:200]
        fields.append('note')
    if 'is_active' in data:
        term.is_active = bool(data.get('is_active'))
        fields.append('is_active')
    if not fields:
        return Response({'detail': 'Nothing to change.'}, status=400)
    term.save(update_fields=fields)
    record(request.user, 'policy_term', f'{term.kind}:{term.text}', ', '.join(fields))
    return Response(policy.row_term(term))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('blocked_words')
def term_create(request):
    return _term_write(request)


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('blocked_words')
def term_update(request, pk):
    if request.method == 'DELETE':
        term = PolicyTerm.objects.filter(pk=pk).first()
        if term is None:
            return Response({'detail': 'No such entry on the list.'}, status=404)
        text, kind = term.text, term.kind
        term.delete()
        record(request.user, 'policy_term', f'{kind}:{text}', 'removed from the list')
        return Response({'detail': f'“{text}” is off the list.', 'kind': kind, 'text': text})
    return _term_write(request, pk)


def _category_write(request, pk=None):
    data = request.data
    category = PolicyCategory.objects.filter(pk=pk).first() if pk else None
    if pk and category is None:
        return Response({'detail': 'No such category.'}, status=404)

    if category is None:
        name = ' '.join(str(data.get('name') or '').split())
        if not name or len(name) > 80:
            return Response({'detail': 'A category name is between 1 and 80 characters.'}, status=400)
        if PolicyCategory.objects.filter(name__iexact=name).exists():
            return Response({'detail': f'{name} is already a category.'}, status=400)
        last = PolicyCategory.objects.order_by('-sort_order').first()
        category = PolicyCategory.objects.create(
            name=name, sort_order=int(data.get('sort_order') or (last.sort_order + 10 if last else 10)),
            created_by=request.user,
        )
        record(request.user, 'policy_category', name, 'added')
        return Response(policy.row_category(category), status=201)

    fields = []
    if 'name' in data:
        name = ' '.join(str(data.get('name') or '').split())
        if not name or len(name) > 80:
            return Response({'detail': 'A category name is between 1 and 80 characters.'}, status=400)
        if PolicyCategory.objects.filter(name__iexact=name).exclude(pk=category.pk).exists():
            return Response({'detail': f'{name} is already a category.'}, status=400)
        category.name = name
        fields.append('name')
    if 'sort_order' in data:
        try:
            category.sort_order = max(0, min(9999, int(data.get('sort_order'))))
        except (TypeError, ValueError):
            return Response({'detail': 'The order has to be a number.'}, status=400)
        fields.append('sort_order')
    if 'is_active' in data:
        category.is_active = bool(data.get('is_active'))
        fields.append('is_active')
    if not fields:
        return Response({'detail': 'Nothing to change.'}, status=400)
    category.save(update_fields=fields)
    record(request.user, 'policy_category', category.name, ', '.join(fields))
    return Response(policy.row_category(category))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('categories')
def category_create(request):
    return _category_write(request)


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('categories')
def category_update(request, pk):
    if request.method == 'DELETE':
        category = PolicyCategory.objects.filter(pk=pk).first()
        if category is None:
            return Response({'detail': 'No such category.'}, status=404)
        name = category.name
        category.delete()
        record(request.user, 'policy_category', name, 'removed')
        return Response({'detail': f'{name} is off the list.', 'name': name})
    return _category_write(request, pk)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('notices')
def notice_list(request):
    rows = PublicNotice.objects.select_related('about', 'actor')
    kind = (request.query_params.get('target') or '').strip()
    if kind in review.KINDS:
        rows = rows.filter(target_type=kind)
    query = (request.query_params.get('q') or '').strip()
    if query:
        # No id here either: the sentence and the person are what a seat remembers.
        rows = rows.filter(
            Q(text__icontains=query) | Q(reason__icontains=query)
            | Q(about__username__icontains=query) | Q(about__email__icontains=query)
            | Q(about__first_name__icontains=query) | Q(about__last_name__icontains=query)
            | Q(about__profile__display_name__icontains=query)
            | Q(actor__username__icontains=query)
        )
    paginator = KeysetPagination()
    page = paginator.paginate_queryset(rows, request)
    response = paginator.get_paginated_response([review.notice_row(notice) for notice in page])
    # The record is opened from a button now, so the chips have to say how much is
    # behind each one before a seat commits to the click.
    by_target = {row['target_type']: row['n']
                 for row in PublicNotice.objects.values('target_type').annotate(n=Count('pk'))}
    response.data['counts'] = {**{kind: by_target.get(kind, 0) for kind in review.KINDS},
                               'all': sum(by_target.values())}
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('notices')
def notice_create(request):
    """Put a warning notice on one piece of content by hand.

    Contract 6.5 says a notice is added and removed only through the dashboard,
    so this is the door. The pen for the kind still has to be on the seat: a seat
    hired for the marketplace holds notices, and notices about a post are not
    its to write.
    """
    target = str(request.data.get('target') or '').strip()
    kind, _, raw_id = target.partition(':')
    if kind not in review.MODEL:
        return Response({'detail': 'Name the content as post:17, comment:17, listing:17 or user:17.'},
                        status=400)
    denied = _held(request, review.KEY_BY_KIND.get(kind))
    if denied is not None:
        return denied
    text = str(request.data.get('text') or '').strip()
    reason = str(request.data.get('reason') or '').strip()
    if not text:
        return Response({'detail': 'Write the sentence they will read.'}, status=400)
    if len(text) > 240:
        return Response({'detail': 'A notice is read over the content it is about, not under it. '
                                   'Keep it to 240 characters.'}, status=400)
    if not reason:
        return Response({'detail': 'Say why the notice is going up, that is the reason the audit row keeps.'},
                        status=400)
    # Checked here rather than inside the write so that a bad answer is a form
    # error, not a missing page: the sentence is the thing that went wrong.
    try:
        audience = review.audience_of(request.data.get('audience'))
    except ValueError as err:
        return Response({'detail': str(err)}, status=400)
    pk = review.pk_of(raw_id)
    if pk is None:
        return Response({'detail': f'{raw_id or "Nothing"} is not an id. Open the content and copy the number.'},
                        status=400)
    if PublicNotice.objects.filter(target_type=kind, target_id=str(pk), is_live=True, text=text).exists():
        return Response({'detail': 'That sentence is already standing on this content.'}, status=400)
    try:
        notice = review.attach(kind, str(pk), request.user, reason, text, audience, email=True)
    except ValueError as err:
        return Response({'detail': str(err)}, status=404)
    record(request.user, 'attach_notice', f'{kind}:{pk}', f'{reason}, {text[:120]}')
    reach = ('only ' + notice['about'] + ' reads it, they are also told in their bell'
             if audience == PublicNotice.Audience.PRIVATE
             else 'anyone reading it now reads this sentence first')
    mailed = notice.get('emailed')
    inbox = (f' A copy is on its way to {mailed["to"]}.' if mailed
             else ' Nothing was mailed: that account has no address, or asks not to be written to.')
    return Response({'notice': notice,
                     'detail': f'The notice is standing on {kind} {pk}. {reach}, '
                               'and the audit row says who put it there.' + inbox,
                     'emailed': mailed},
                    status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('notices')
def notice_withdraw(request, pk):
    """Take a public notice down again, say who did it, and tell the account it stood on.

    Withdrawing is not deleting: the notice was on the platform, people read it,
    and a later question about why it vanished has one honest answer. And a
    sentence that stops showing is only half a retraction until the person it was
    written over is told it stopped, so the bell row and the letter go with it.
    """
    notice = PublicNotice.objects.filter(pk=pk).first()
    if notice is None:
        return Response({'detail': 'No such notice.'}, status=404)
    # The aside's "withdraw every sentence on this target" comes down as several
    # calls, and three letters about one post is three letters too many: it asks
    # for the rows to come down without the telling, and says so in its own line.
    quiet = str(request.data.get('tell', '1')).strip().lower() in ('0', 'false', 'no', '')
    try:
        out = review.withdraw(notice, request.user, tell=not quiet)
    except ValueError as err:
        return Response({'detail': str(err)}, status=400)
    told = out.get('told') or {}
    mailed = told.get('emailed')
    out['detail'] = (
        'The notice is withdrawn and the audit row says who took it down. '
        if not quiet else
        'The notice is withdrawn and the audit row says who took it down, and the seat that '
        'brought it down chose not to tell the account about this one. '
    ) + (
        '' if quiet else
        f'@{out["about"]} '
        + ('read the retraction in their bell' if told.get('bell')
           else 'got no bell row, because the seat that withdrew it is their own')
        + (f', and a copy is on its way to {mailed["to"]}.' if mailed
           else ', and nothing was mailed: that account has no address on file, or asks '
                'not to be written to about warnings.')
    )
    return Response(out)


@api_view(['GET'])
@permission_classes([AllowAny])
def public_notices(request, kind, pk):
    """What the community is told about one piece of content or one account.

    A notice that only staff can read is an internal note, so this is the door
    the site's own screens would open; the console does not render it.
    """
    if kind not in review.KINDS:
        return Response({'detail': 'Choose post, comment, listing or user.'}, status=400)
    gate = Q(audience=PublicNotice.Audience.PUBLIC)
    # A notice aimed at one account is read by that account and nobody else; an
    # anonymous visitor is not the person it was written for, so they see the
    # sentences written over their content and stop there.
    if getattr(request.user, 'pk', None):
        gate |= Q(audience=PublicNotice.Audience.PRIVATE, about_id=request.user.pk)
    rows = PublicNotice.objects.filter(
        target_type=kind, target_id=str(pk), is_live=True,
    ).filter(gate).select_related('about', 'actor')
    return Response({'target': f'{kind}:{pk}', 'notices': [review.notice_row(row) for row in rows[:10]]})
