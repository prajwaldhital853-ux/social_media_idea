from rest_framework import serializers

from .models import Comment


class CommentSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)

    class Meta:
        model = Comment
        fields = [
            'id', 'post', 'author', 'author_username', 'parent', 'media_index',
            'text', 'status', 'created_at',
        ]
        read_only_fields = ['id', 'author', 'status', 'created_at']

    def validate(self, attrs):
        post = attrs.get('post') or (self.instance.post if self.instance else None)
        user = self.context['request'].user
        if post and post.status != 'live' and post.author_id != user.id and not user.is_staff:
            raise serializers.ValidationError('This post is not accepting comments.')
        parent = attrs.get('parent')
        if parent and post and parent.post_id != post.id:
            raise serializers.ValidationError('Reply must belong to the same post.')
        return attrs