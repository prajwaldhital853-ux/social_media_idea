"""Contract 6.4 endpoints: the directory, one account, and what a seat may do to it.

Two keys and one rule. `users` opens the list and a single account; `user_actions`
is the pen for suspending, reinstating, verifying, clearing flags and deleting;
`warnings` is the pen for a private note. A seat that can read everybody and sign
nobody is a normal hire, that is what a night moderator with read access looks
like, so the verbs are answered per screen, not assumed from the roster row.

The account itself is the site's own: suspension is `suspended_until`, the tick is
`profile.verified`, the pile is the same reports the queue counts. `people.py`
owns what each action does; this file only turns a request into a call and a
refusal into the sentence the console shows.
"""

from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.adminpanel.models import PublicNotice
from apps.common.pagination import KeysetPagination

from . import people, rbac

NO_SEAT = {'detail': 'That username is not an account on the platform.'}


def _account(username):
    """(user, None) or (None, the 404 to hand back). Staff seats have their own screen."""
    user = User.objects.filter(username=username).exclude(
        Q(is_staff=True) | Q(is_superuser=True) | Q(staff_account__is_enabled=True)
    ).first()
    if user is None:
        return None, Response(NO_SEAT, status=404)
    return user, None


def _verbs(request):
    """What this seat may do to an account, so the screen draws buttons or a note."""
    return {
        'actions': rbac.can(request.staff_account, 'user_actions'),
        'warn': rbac.can(request.staff_account, 'warnings'),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('users')
def people_directory(request):
    """Everybody on the platform, with how they joined and what is standing against them."""
    try:
        rows = people.directory(
            request.query_params.get('q') or '',
            request.query_params.get('status') or 'all',
            request.query_params.get('provider') or '',
        )
    except people.Refused as exc:
        return Response({'detail': str(exc)}, status=400)
    paginator = KeysetPagination()
    page = paginator.paginate_queryset(rows, request)
    response = paginator.get_paginated_response(people.rows(page))
    response.data['facets'] = people.facets(rows)
    response.data['can'] = _verbs(request)
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('users')
def person_detail(request, username):
    """One account opened: the pile on it and its content, what staff have told it, the record."""
    user, error = _account(username)
    if error is not None:
        return error
    out = people.detail(user)
    out['can'] = _verbs(request)
    return Response(out)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('user_actions')
def person_suspend(request, username):
    """A bar with an end date, or one without, that signs them out and tells them why."""
    user, error = _account(username)
    if error is not None:
        return error
    data = request.data
    try:
        out = people.suspend(
            user, request.user,
            reason=data.get('reason') or '',
            days=data.get('days'),
            until=data.get('until'),
            permanent=bool(data.get('permanent')),
        )
    except people.Refused as exc:
        return Response({'detail': str(exc)}, status=400)
    out['person'] = people.row(user)
    return Response(out)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('user_actions')
def person_reinstate(request, username):
    user, error = _account(username)
    if error is not None:
        return error
    try:
        out = people.reinstate(user, request.user)
    except people.Refused as exc:
        return Response({'detail': str(exc)}, status=400)
    out['person'] = people.row(user)
    return Response(out)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('user_actions')
def person_verify(request, username):
    """The blue tick, put on or taken off, with the reason the audit row keeps."""
    user, error = _account(username)
    if error is not None:
        return error
    if 'verified' not in request.data:
        return Response({'detail': 'Say whether the tick should be on or off.'}, status=400)
    try:
        out = people.verify(
            user, request.user,
            verified=bool(request.data.get('verified')),
            reason=request.data.get('reason') or '',
        )
    except people.Refused as exc:
        return Response({'detail': str(exc)}, status=400)
    return Response(out)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('warnings')
def person_warn(request, username):
    """A public or private warning: their bell, their inbox unless opted out, the record."""
    user, error = _account(username)
    if error is not None:
        return error
    try:
        out = people.warn(
            user, request.user,
            text=request.data.get('text') or '',
            reason=request.data.get('reason') or '',
            audience=request.data.get('audience') or PublicNotice.Audience.PRIVATE,
        )
    except (people.Refused, ValueError) as exc:
        return Response({'detail': str(exc)}, status=400)
    return Response(out)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('user_actions')
def person_clear_flags(request, username):
    """The pile closed and the lockout cleared, a decision nobody has to re-report."""
    user, error = _account(username)
    if error is not None:
        return error
    try:
        out = people.clear_flags(user, request.user, reason=request.data.get('reason') or '')
    except people.Refused as exc:
        return Response({'detail': str(exc)}, status=400)
    out['person'] = people.row(user)
    return Response(out)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('user_actions')
def person_delete(request, username):
    """An account destroyed. The guards in `people.delete()` are the whole safety here."""
    user, error = _account(username)
    if error is not None:
        return error
    try:
        out = people.delete(
            user, request.user,
            confirm=request.data.get('confirm') or '',
            reason=request.data.get('reason') or '',
        )
    except people.Refused as exc:
        return Response({'detail': str(exc)}, status=400)
    return Response(out)
