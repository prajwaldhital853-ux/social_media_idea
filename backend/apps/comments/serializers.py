from rest_framework import serializers

from apps.common.api import notice_map, user_reaction_map
from apps.posts.views import visible_posts

from .models import Comment


class CommentListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        comments = list(data.all() if hasattr(data, 'all') else data)
        self.context['_comment_reactions'] = user_reaction_map(
            self.context.get('request'), 'comment', [c.pk for c in comments]
        )
        self.context['_comment_notices'] = notice_map('comment', [c.pk for c in comments], self.context.get('request'))
        return [self.child.to_representation(comment) for comment in comments]


class CommentSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)
    author_name = serializers.CharField(source='author.profile.display_name', read_only=True)
    author_avatar_url = serializers.CharField(source='author.profile.avatar_url', read_only=True)
    author_verified = serializers.BooleanField(source='author.profile.verified', read_only=True)
    reply_count = serializers.SerializerMethodField()
    my_reaction = serializers.SerializerMethodField()
    is_post_author = serializers.SerializerMethodField()
    notices = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            'id', 'post', 'author', 'author_username', 'author_name', 'author_avatar_url', 'author_verified',
            'parent', 'media_index', 'text', 'status', 'like_count', 'reply_count', 'my_reaction',
            'is_post_author', 'notices', 'created_at',
        ]
        read_only_fields = ['id', 'author', 'status', 'like_count', 'created_at']
        list_serializer_class = CommentListSerializer

    def get_is_post_author(self, obj):
        # The badge follows the person who owns the post, and a reply inherits it:
        # an author answering under their own post is still the author.
        return obj.author_id == obj.post.author_id

    def get_reply_count(self, obj):
        value = getattr(obj, 'annotated_reply_count', None)
        return value if value is not None else obj.replies.filter(status=Comment.Status.LIVE).count()

    def get_my_reaction(self, obj):
        if '_comment_reactions' not in self.context:
            self.context['_comment_reactions'] = user_reaction_map(
                self.context.get('request'), 'comment', [obj.pk]
            )
        return self.context['_comment_reactions'].get(str(obj.pk))

    def get_notices(self, obj):
        # A page fills this once; a single read asks for its own row.
        if '_comment_notices' not in self.context:
            self.context['_comment_notices'] = notice_map('comment', [obj.pk], self.context.get('request'))
        return self.context['_comment_notices'].get(str(obj.pk), [])

    def validate(self, attrs):
        post = attrs.get('post') or (self.instance.post if self.instance else None)
        user = self.context['request'].user
        # The same rule as reading: if the post is not in your view, it is not a
        # place you may speak — a private or follower-only author keeps a closed
        # thread even when someone guesses the post id.
        if post and not visible_posts(user).filter(pk=post.pk).exists():
            raise serializers.ValidationError('This post is not accepting comments.')
        parent = attrs.get('parent')
        if parent and post and parent.post_id != post.id:
            raise serializers.ValidationError('Reply must belong to the same post.')
        if parent and parent.status != Comment.Status.LIVE:
            raise serializers.ValidationError('This comment is not accepting replies.')
        return attrs
