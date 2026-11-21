from django.db import IntegrityError, transaction
from django.db.models import F
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated, IsAuthenticatedOrReadOnly, SAFE_METHODS
from rest_framework.response import Response

from apps.comments.models import Comment
from apps.notifications.services import notify
from apps.posts.models import Post, PostMedia

from .models import Reaction
from .serializers import ReactionSerializer


class IsOwnerOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.method in SAFE_METHODS or obj.user_id == request.user.id


def _media_target(target_id):
    """'<post id>#m<position>' -> (post_id, position) or None."""
    post_id, hash_marker, rest = str(target_id).partition('#m')
    if hash_marker and post_id.isdigit() and rest.isdigit():
        return int(post_id), int(rest)
    return None


def _adjust_counter(target_type, target_id, delta):
    if target_type == 'post' and str(target_id).isdigit():
        Post.objects.filter(pk=int(target_id)).update(like_count=F('like_count') + delta)
    elif target_type == 'comment' and str(target_id).isdigit():
        Comment.objects.filter(pk=int(target_id)).update(like_count=F('like_count') + delta)
    elif target_type == 'media':
        media = _media_target(target_id)
        if media:
            PostMedia.objects.filter(post_id=media[0], position=media[1]).update(like_count=F('like_count') + delta)


def _notify_target(request, target_type, target_id):
    """Tell the owner of the liked thing — except when they liked their own."""
    owner = None
    href_kind = target_type
    if target_type == 'post' and str(target_id).isdigit():
        post = Post.objects.filter(pk=int(target_id)).select_related('author').first()
        owner = post.author if post else None
    elif target_type == 'comment' and str(target_id).isdigit():
        comment = Comment.objects.filter(pk=int(target_id)).select_related('author').first()
        owner = comment.author if comment else None
    elif target_type == 'media':
        media = _media_target(target_id)
        if media:
            post = Post.objects.filter(pk=media[0]).select_related('author').first()
            owner = post.author if post else None
            href_kind = 'post'
    if owner and owner.pk != request.user.pk:
        notify(owner, request.user, 'reaction', f'{request.user.username} reacted to your {target_type}.', href_kind, target_id)


class ReactionViewSet(viewsets.ModelViewSet):
    serializer_class = ReactionSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]

    def get_queryset(self):
        qs = Reaction.objects.select_related('user')
        target_type = self.request.query_params.get('target_type')
        target_id = self.request.query_params.get('target_id')
        if target_type:
            qs = qs.filter(target_type=target_type)
        if target_id:
            qs = qs.filter(target_id=target_id)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_type = serializer.validated_data['target_type']
        target_id = serializer.validated_data['target_id']
        for attempt in range(2):
            try:
                with transaction.atomic():
                    obj, created = Reaction.objects.update_or_create(
                        user=request.user,
                        target_type=target_type,
                        target_id=target_id,
                        defaults={'kind': serializer.validated_data['kind']},
                    )
                    if created:
                        _adjust_counter(obj.target_type, obj.target_id, 1)
                break
            except IntegrityError:
                if attempt:
                    raise
        if created:
            _notify_target(request, obj.target_type, obj.target_id)
        return Response(self.get_serializer(obj).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def perform_destroy(self, instance):
        with transaction.atomic():
            deleted, _ = Reaction.objects.filter(pk=instance.pk).delete()
            if deleted:
                _adjust_counter(instance.target_type, instance.target_id, -1)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def toggle_off(request):
    target_type = request.data.get('target_type') or request.query_params.get('target_type')
    target_id = request.data.get('target_id') or request.query_params.get('target_id')
    reaction = Reaction.objects.filter(user=request.user, target_type=target_type, target_id=str(target_id)).first()
    if not reaction:
        return Response({'detail': 'No reaction to remove.'}, status=404)
    with transaction.atomic():
        deleted, _ = Reaction.objects.filter(pk=reaction.pk).delete()
        if not deleted:
            return Response({'detail': 'No reaction to remove.'}, status=404)
        _adjust_counter(target_type, target_id, -1)
    return Response({'detail': 'Reaction removed.'})