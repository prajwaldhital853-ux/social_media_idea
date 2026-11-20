from django.db.models import Q
from rest_framework import viewsets
from rest_framework.permissions import BasePermission, IsAuthenticatedOrReadOnly, SAFE_METHODS

from .models import Post
from .serializers import PostSerializer


class IsAuthorOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.method in SAFE_METHODS or obj.author_id == request.user.id


class PostViewSet(viewsets.ModelViewSet):
    serializer_class = PostSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, IsAuthorOrReadOnly]

    def get_queryset(self):
        qs = Post.objects.select_related('author').prefetch_related('media')
        user = self.request.user
        if user.is_authenticated and user.is_staff:
            return qs
        visible = Q(status=Post.Status.LIVE, audience=Post.Audience.PUBLIC)
        if user.is_authenticated:
            visible |= Q(author=user)
            visible |= Q(
                status=Post.Status.LIVE,
                audience=Post.Audience.FOLLOWERS,
                author__followers__follower=user,
            )
        return qs.filter(visible).distinct()

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)