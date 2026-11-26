from datetime import timedelta

from django.db.models import Count, F, Q
from django.db.models.functions import Greatest
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.adminpanel import rbac
from apps.accounts.models import User
from apps.comments.models import Comment
from apps.common.emails import queue_report_email
from apps.common.pagination import KeysetPagination
from apps.marketplace.models import Listing
from apps.notifications.services import notify
from apps.posts.models import Post
from apps.wallet.models import Wallet

from .models import AuditLog, Report


class ReportSerializer(serializers.ModelSerializer):
    reporter_username = serializers.CharField(source='reporter.username', read_only=True)

    class Meta:
        model = Report
        fields = ['id', 'reporter', 'reporter_username', 'target_type', 'target_id', 'reason', 'details', 'status', 'created_at', 'resolved_at']
        read_only_fields = ['id', 'reporter', 'status', 'created_at', 'resolved_at']


def audit(actor, action, target='', detail=''):
    from apps.adminpanel.journal import record
    return record(actor, action, target, detail)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def reports(request):
    if request.method == 'POST':
        serializer = ReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # One report per thing per day, per person. Re-sending the same one does
        # not move it up the queue — the auto-hide counter counts distinct
        # reporters, not rows — so it only buries the pile in duplicates.
        if Report.objects.filter(
            reporter=request.user,
            target_type=serializer.validated_data['target_type'],
            target_id=serializer.validated_data['target_id'],
            created_at__gte=timezone.now() - timedelta(days=1),
        ).exists():
            return Response(
                {'detail': 'You already reported this today. Each post, comment or account can '
                           'be reported once every 24 hours — our team has it.'},
                status=429,
            )
        obj = serializer.save(reporter=request.user)
        _auto_hide_if_piled_on(obj)
        queue_report_email(obj)
        return Response(ReportSerializer(obj).data, status=status.HTTP_201_CREATED)
    if not request.user.is_staff:
        return Response({'detail': 'Staff only.'}, status=403)
    qs = Report.objects.select_related('reporter')
    if request.query_params.get('status'):
        qs = qs.filter(status=request.query_params['status'])
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(ReportSerializer(rows, many=True).data)


def _auto_hide_if_piled_on(report):
    """Enough distinct reporters on one post and it leaves the feed pending review.

    Both halves of that rule live on the console's spam desk: `spam_autohide` says
    whether a pile may pull anything at all, and `report_threshold()` is the size of
    the pile. With the switch off the report still reaches the review queue and the
    email, it just waits for a person instead of a number.
    """
    if report.target_type != Report.Target.POST or not report.target_id.isdigit():
        return
    from apps.adminpanel import spam

    if not spam.autohide():
        return
    threshold = spam.report_threshold()
    distinct = Report.objects.filter(
        target_type=Report.Target.POST, target_id=report.target_id, status=Report.Status.OPEN,
    ).values('reporter').distinct().count()
    if distinct < threshold:
        return
    post = Post.objects.filter(pk=int(report.target_id), status=Post.Status.LIVE).first()
    if not post:
        return
    post.status = Post.Status.HIDDEN
    post.save(update_fields=['status'])
    notify(post.author, None, 'warning',
           f'Your post, posted {timezone.localtime(post.created_at):%d %b %Y at %H:%M}, '
           f'was suspended due to: {distinct} people reported it ({report.reason}).',
           'post', post.pk)
    audit(None, 'auto_hide_post', f'post:{post.pk}', f'{distinct} open reports')


def _remove_target(report, actor):
    kind, tid = report.target_type, report.target_id
    owner = None
    content = None
    if kind == 'post' and tid.isdigit():
        content = Post.objects.filter(pk=int(tid)).first()
        if content:
            content.status = Post.Status.REMOVED
            content.save(update_fields=['status'])
            owner = content.author
    elif kind == 'comment' and tid.isdigit():
        content = Comment.objects.filter(pk=int(tid)).first()
        if content and content.status != Comment.Status.REMOVED:
            content.status = Comment.Status.REMOVED
            content.save(update_fields=['status'])
            Post.objects.filter(pk=content.post_id).update(comment_count=Greatest(F('comment_count') - 1, 0))
            owner = content.author
    elif kind == 'listing' and tid.isdigit():
        content = Listing.objects.filter(pk=int(tid)).first()
        if content:
            content.status = Listing.Status.REMOVED
            content.save(update_fields=['status'])
            owner = content.seller
    if owner:
        posted = f', posted {timezone.localtime(content.created_at):%d %b %Y at %H:%M},' if kind != 'listing' else ','
        notify(owner, actor, 'warning',
               f'Your {kind}{posted} was suspended due to: {report.reason}.', kind, tid)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('reports')
def report_action(request, pk, action):
    report = get_object_or_404(Report, pk=pk)
    if report.status not in (Report.Status.OPEN, Report.Status.REVIEWING):
        return Response({'detail': 'Report already closed.'}, status=400)
    if action == 'dismiss':
        report.status = Report.Status.DISMISSED
    elif action == 'resolve':
        report.status = Report.Status.RESOLVED
    elif action == 'remove':
        _remove_target(report, request.user)
        report.status = Report.Status.RESOLVED
    else:
        return Response({'detail': 'Unknown action.'}, status=400)
    report.resolved_at = timezone.now()
    report.save(update_fields=['status', 'resolved_at'])
    audit(request.user, f'{action}_report', f'{report.target_type}:{report.target_id}', report.reason)
    return Response(ReportSerializer(report).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('user_actions')
def suspend(request, username):
    user = get_object_or_404(User, username=username)
    days = int(request.data.get('days', 7))
    reason = (request.data.get('reason') or 'Community policy violation.')[:200]
    user.suspended_until = timezone.now() + timedelta(days=days)
    user.suspend_reason = reason
    user.save(update_fields=['suspended_until', 'suspend_reason'])
    notify(user, request.user, 'warning', f'Your account is suspended for {days} days: {reason}')
    audit(request.user, 'suspend_user', username, f'{days} days: {reason}')
    return Response({'suspended_until': user.suspended_until})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('user_actions')
def reinstate(request, username):
    user = get_object_or_404(User, username=username)
    user.suspended_until = None
    user.suspend_reason = ''
    user.save(update_fields=['suspended_until', 'suspend_reason'])
    notify(user, request.user, 'warning', 'Your account suspension was lifted.')
    audit(request.user, 'reinstate_user', username)
    return Response({'suspended_until': None})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('audit')
def audit_log(request):
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(AuditLog.objects.select_related('actor'), request)
    data = [
        {'id': r.pk, 'actor': r.actor.username if r.actor else None, 'action': r.action, 'target': r.target, 'detail': r.detail, 'created_at': r.created_at}
        for r in rows
    ]
    return paginator.get_paginated_response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('users')
def user_directory(request):
    """The member roster the admin console works on: accounts, balances and moderation state."""
    qs = (
        User.objects.select_related('profile')
        .exclude(
            Q(is_staff=True) | Q(is_superuser=True) | Q(staff_account__is_enabled=True)
        )
        .annotate(
            created_at=F('date_joined'),
            posts_count=Count('posts', filter=Q(posts__status='live'), distinct=True),
            followers_count=Count('followers', filter=Q(followers__status='accepted'), distinct=True),
        )
    )
    query = (request.query_params.get('q') or '').strip()
    if query:
        qs = qs.filter(
            Q(username__icontains=query) | Q(email__icontains=query)
            | Q(first_name__icontains=query) | Q(last_name__icontains=query)
        )
    state = request.query_params.get('status')
    now = timezone.now()
    if state == 'suspended':
        qs = qs.filter(suspended_until__gt=now)
    elif state == 'locked':
        qs = qs.filter(locked_until__gt=now)
    elif state == 'active':
        qs = qs.filter(suspended_until__isnull=True, locked_until__isnull=True)
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    balances = {
        wallet.user_id: wallet.balance
        for wallet in Wallet.objects.filter(user__in=[row.pk for row in rows])
    }
    data = []
    for row in rows:
        profile = row.profile
        data.append({
            'id': row.pk,
            'username': row.username,
            'name': profile.display_name or row.get_full_name() or row.username,
            'email': row.email,
            'bio': profile.bio,
            'avatar_url': profile.avatar_url,
            'verified': profile.verified,
            'is_private': profile.is_private,
            'role': 'superadmin' if row.is_superuser else 'admin' if row.is_staff else 'user',
            'provider': row.provider,
            'email_verified': row.email_verified,
            'country': row.country,
            'city': row.city,
            'dob': row.date_of_birth,
            'joined': row.date_joined,
            'coins': int(balances.get(row.pk, 0)),
            'posts': row.posts_count,
            'followers': row.followers_count,
            'suspended_until': row.suspended_until,
            'suspend_reason': row.suspend_reason,
            'locked_until': row.locked_until,
            'is_active': row.is_active,
        })
    return paginator.get_paginated_response(data)
