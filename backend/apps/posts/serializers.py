from rest_framework import serializers

from .models import Post, PostMedia


class PostMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostMedia
        fields = ['id', 'kind', 'url', 'file', 'duration', 'position']
        read_only_fields = ['id']


class PostSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)
    media = PostMediaSerializer(many=True, required=False)

    class Meta:
        model = Post
        fields = [
            'id', 'author', 'author_username', 'text', 'audience', 'status',
            'mood', 'place', 'edited', 'created_at', 'updated_at', 'media',
        ]
        read_only_fields = ['id', 'author', 'status', 'edited', 'created_at', 'updated_at']

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