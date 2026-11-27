from django.db import transaction
from django.db.models import Count, F, Q
from rest_framework import viewsets
from rest_framework.permissions import BasePermission, IsAuthenticatedOrReadOnly, SAFE_METHODS

from apps.common.api import thread_counts
from apps.common.rules import blocked_wording, write_gate
from apps.notifications.services import notify
from apps.posts.models import Post
from apps.posts.views import visible_posts

from .models import Comment
from .serializers import CommentSerializer


class IsAuthorOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.method in SAFE_METHODS or obj.author_id == request.user.id


def _pulse_comments(post, *, row=None, deleted_ids=None, parent_id=None, author_id=None):
    """The fresh tally for the room, the full row for readers of this post."""
    from apps.common import pulse
    from apps.profiles.models import Profile

    # The number every card and sheet wears is the number of lines that sheet
    # can fill, so a reply landing under its parent moves nothing a reader can
    # count against the list in front of them.
    count = thread_counts([post.pk]).get(str(post.pk), 0)
    event = {'post_id': str(post.pk), 'comments': count}
    pulse.to_user(post.author_id, 'comment', **event)
    room = post.audience == Post.Audience.PUBLIC and not Profile.objects.filter(
        user_id=post.author_id).values_list('is_private', flat=True).first()
    if room:
        pulse.to_site('comment', **event)

    detail = {**event, 'action': 'create' if row else 'delete'}
    if row:
        detail.update(comment=row, comment_id=str(row['id']), author_id=row.get('author'))
    if deleted_ids:
        detail['deleted_ids'] = [str(pk) for pk in deleted_ids]
    if author_id:
        detail['author_id'] = author_id
    if parent_id:
        detail['parent_id'] = str(parent_id)
        detail['parent_replies'] = Comment.objects.filter(pk=parent_id).aggregate(
            n=Count('replies', filter=Q(replies__status=Comment.Status.LIVE), distinct=True),
        )['n'] or 0
    pulse.to_post(post.pk, 'comment', **detail)
    pulse.to_staff('comment', **{key: value for key, value in detail.items() if key != 'comment'})


class CommentViewSet(viewsets.ModelViewSet):
    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, IsAuthorOrReadOnly]

    def get_queryset(self):
        qs = Comment.objects.filter(
            status=Comment.Status.LIVE,
            post__in=visible_posts(self.request.user),
        ).select_related('author', 'author__profile', 'post').annotate(
            annotated_reply_count=Count(
                'replies', filter=Q(replies__status=Comment.Status.LIVE), distinct=True,
            )
        )
        post_id = self.request.query_params.get('post')
        if post_id:
            qs = qs.filter(post_id=post_id)
        parent = self.request.query_params.get('parent')
        if parent:
            qs = qs.filter(parent_id=parent)
        media_index = self.request.query_params.get('media_index')
        on_media = media_index is not None and media_index != ''
        if on_media:
            qs = qs.filter(media_index=media_index)
        # The comment stream pages over top-level comments only; replies are a
        # separate keyset under their parent so one long thread cannot hide the
        # rest. A word left on one photo is a line of that picture's own thread,
        # so the post's stream pages without it — otherwise the reader gets a
        # slot in the page that renders as nothing.
        if self.request.query_params.get('top'):
            qs = qs.filter(parent__isnull=True)
            if not on_media:
                qs = qs.filter(media_index__isnull=True)
        return qs

    def create(self, request, *args, **kwargs):
        """Words on the console's blocked list are answered, not saved, and so is a
        seat that has run past the comment ceiling the spam desk is holding."""
        refused = blocked_wording(request, 'comment')
        if refused:
            return refused
        gate = write_gate(request, 'comment')
        if gate:
            return gate
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        """So is an edit that puts them back in afterwards."""
        refused = blocked_wording(request, 'comment')
        if refused:
            return refused
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        with transaction.atomic():
            Post.objects.select_for_update().get(pk=serializer.validated_data['post'].pk)
            comment = serializer.save(author=self.request.user)
            Post.objects.filter(pk=comment.post_id).update(comment_count=F('comment_count') + 1)
        post = comment.post
        if comment.parent_id:
            notify(comment.parent.author, self.request.user, 'reply', f'{self.request.user.username} replied to your comment.', 'post', post.pk)
        else:
            notify(post.author, self.request.user, 'comment', f'{self.request.user.username} commented on your post.', 'post', post.pk)
        row = CommentSerializer(comment, context={'request': self.request, '_comment_pulse': True}).data
        row.pop('my_reaction', None)
        row.pop('notices', None)
        _pulse_comments(post, row=row, parent_id=comment.parent_id, author_id=comment.author_id)

    def perform_destroy(self, instance):
        post_id = instance.post_id
        deleted_ids = [instance.pk, *instance.replies.values_list('pk', flat=True)]
        with transaction.atomic():
            Post.objects.select_for_update().get(pk=post_id)
            delta = 1 + instance.replies.count()
            deleted, _ = Comment.objects.filter(pk=instance.pk).delete()
            if deleted:
                Post.objects.filter(pk=post_id).update(comment_count=F('comment_count') - delta)
        if deleted:
            post = Post.objects.filter(pk=post_id).first()
            if post:
                _pulse_comments(
                    post, deleted_ids=deleted_ids, parent_id=instance.parent_id,
                    author_id=instance.author_id,
                )