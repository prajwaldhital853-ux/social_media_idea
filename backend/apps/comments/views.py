from django.db import transaction
from django.db.models import Count, F, Q
from rest_framework import viewsets
from rest_framework.permissions import BasePermission, IsAuthenticatedOrReadOnly, SAFE_METHODS

from apps.notifications.services import notify
from apps.posts.models import Post

from .models import Comment
from .serializers import CommentSerializer


class IsAuthorOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.method in SAFE_METHODS or obj.author_id == request.user.id


class CommentViewSet(viewsets.ModelViewSet):
    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, IsAuthorOrReadOnly]

    def get_queryset(self):
        qs = Comment.objects.select_related('author', 'author__profile', 'post').annotate(
            annotated_reply_count=Count('replies', distinct=True)
        )
        user = self.request.user
        if not (user.is_authenticated and user.is_staff):
            visible = Q(post__status='live')
            if user.is_authenticated:
                visible |= Q(author=user) | Q(post__author=user)
            qs = qs.filter(visible)
        post_id = self.request.query_params.get('post')
        if post_id:
            qs = qs.filter(post_id=post_id)
        parent = self.request.query_params.get('parent')
        if parent:
            qs = qs.filter(parent_id=parent)
        media_index = self.request.query_params.get('media_index')
        if media_index is not None and media_index != '':
            qs = qs.filter(media_index=media_index)
        return qs

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

    def perform_destroy(self, instance):
        post_id = instance.post_id
        with transaction.atomic():
            Post.objects.select_for_update().get(pk=post_id)
            delta = 1 + instance.replies.count()
            deleted, _ = Comment.objects.filter(pk=instance.pk).delete()
            if deleted:
                Post.objects.filter(pk=post_id).update(comment_count=F('comment_count') - delta)