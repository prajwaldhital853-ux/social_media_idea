from rest_framework import serializers

from apps.common.api import notice_map, post_page_reactions

from .models import Post, PostMedia


class PostMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostMedia
        fields = ['id', 'kind', 'url', 'file', 'duration', 'position', 'like_count']
        # position is assigned from the order the client sends, never from the payload.
        read_only_fields = ['id', 'like_count', 'position']


class PostListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        posts = list(data.all() if hasattr(data, 'all') else data)
        self.context['_reactions'] = post_page_reactions(self.context.get('request'), posts)
        self.context['_notices'] = notice_map('post', [post.pk for post in posts], self.context.get('request'))
        return [self.child.to_representation(post) for post in posts]


class PostSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)
    author_name = serializers.CharField(source='author.profile.display_name', read_only=True)
    author_avatar_url = serializers.CharField(source='author.profile.avatar_url', read_only=True)
    author_verified = serializers.BooleanField(source='author.profile.verified', read_only=True)
    # A card for an author the viewer has never met still has to say whether
    # following them is a follow or a request.
    author_is_private = serializers.BooleanField(source='author.profile.is_private', read_only=True)
    media = PostMediaSerializer(many=True, required=False)
    my_reaction = serializers.SerializerMethodField()
    my_media_reactions = serializers.SerializerMethodField()
    reaction_kinds = serializers.SerializerMethodField()
    media_reaction_kinds = serializers.SerializerMethodField()
    reaction_people = serializers.SerializerMethodField()
    notices = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = [
            'id', 'author', 'author_username', 'author_name', 'author_avatar_url', 'author_verified',
            'author_is_private', 'text', 'audience', 'status',
            'mood', 'place', 'category', 'activity', 'like_count', 'comment_count', 'share_count', 'views',
            'edited', 'created_at', 'updated_at', 'media',
            'my_reaction', 'my_media_reactions', 'reaction_kinds', 'media_reaction_kinds', 'reaction_people',
            'notices',
        ]
        read_only_fields = ['id', 'author', 'status', 'activity', 'like_count', 'comment_count',
                            'share_count', 'views', 'edited', 'created_at', 'updated_at']
        list_serializer_class = PostListSerializer

    def _reactions(self):
        """The page serializer pre-fills this; a single-object call loads its own row."""
        if '_reactions' not in self.context:
            self.context['_reactions'] = post_page_reactions(
                self.context.get('request'), [self.instance] if self.instance else []
            )
        return self.context['_reactions']

    def get_my_reaction(self, obj):
        return self._reactions()['post'].get(str(obj.pk))

    def get_my_media_reactions(self, obj):
        media_map = self._reactions()['media']
        return {str(m.position): media_map.get(f'{obj.pk}#m{m.position}') for m in obj.media.all()}

    def get_reaction_kinds(self, obj):
        return self._reactions()['post_kinds'].get(str(obj.pk), {})

    def get_media_reaction_kinds(self, obj):
        media_kinds = self._reactions()['media_kinds']
        return {str(m.position): media_kinds.get(f'{obj.pk}#m{m.position}', {}) for m in obj.media.all()}

    def get_reaction_people(self, obj):
        return self._reactions()['people'].get(str(obj.pk), [])

    def get_notices(self, obj):
        # A page fills this once; a single read asks for its own row.
        if '_notices' not in self.context:
            self.context['_notices'] = notice_map('post', [obj.pk], self.context.get('request'))
        return self.context['_notices'].get(str(obj.pk), [])

    def create(self, validated_data):
        media_data = validated_data.pop('media', [])
        post = Post.objects.create(**validated_data)
        for position, item in enumerate(media_data):
            PostMedia.objects.create(post=post, position=position, **item)
        return post

    def update(self, instance, validated_data):
        media_data = validated_data.pop('media', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.edited = True
        instance.save()
        if media_data is not None:
            instance.media.all().delete()
            for position, item in enumerate(media_data):
                PostMedia.objects.create(post=instance, position=position, **item)
        return instance
