from rest_framework import serializers

from apps.common.api import user_reaction_map
from apps.posts.views import visible_posts

from .models import Comment


class CommentListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        comments = list(data.all() if hasattr(data, 'all') else data)
        self.context['_comment_reactions'] = user_reaction_map(
            self.context.get('request'), 'comment', [c.pk for c in comments]
        )
        return [self.child.to_representation(comment) for comment in comments]


class CommentSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)
    author_name = serializers.CharField(source='author.profile.display_name', read_only=True)
    author_avatar_url = serializers.CharField(source='author.profile.avatar_url', read_only=True)
    author_verified = serializers.BooleanField(source='author.profile.verified', read_only=True)
    reply_count = serializers.SerializerMethodField()
    my_reaction = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            'id', 'post', 'author', 'author_username', 'author_name', 'author_avatar_url', 'author_verified',
            'parent', 'media_index', 'text', 'status', 'like_count', 'reply_count', 'my_reaction', 'created_at',
        ]
        read_only_fields = ['id', 'author', 'status', 'like_count', 'created_at']
        list_serializer_class = CommentListSerializer

    def get_reply_count(self, obj):
        value = getattr(obj, 'annotated_reply_count', None)
        return value if value is not None else obj.replies.count()

    def get_my_reaction(self, obj):
        if '_comment_reactions' not in self.context:
            self.context['_comment_reactions'] = user_reaction_map(
                self.context.get('request'), 'comment', [obj.pk]
            )
        return self.context['_comment_reactions'].get(str(obj.pk))

    def validate(self, attrs):
        post = attrs.get('post') or (self.instance.post if self.instance else None)
        user = self.context['request'].user
        # The same rule as reading: if the post is not in your view, it is not a
        # place you may speak — a private or follower-only author keeps a closed
        # thread even when someone guesses the post id.
        if post and post.author_id != user.id and not visible_posts(user).filter(pk=post.pk).exists():
            raise serializers.ValidationError('This post is not accepting comments.')
        parent = attrs.get('parent')
        if parent and post and parent.post_id != post.id:
            raise serializers.ValidationError('Reply must belong to the same post.')
        return attrs
