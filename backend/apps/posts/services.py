"""Post-side helpers other apps call so they don't reach into the models directly."""

from .models import Post, PostMedia


def announce_profile_change(user, kind, url):
    """Publish a profile/cover change so followers see it in the feed.

    The caption is empty on purpose: the card is labelled from ``activity``, so
    the wording stays in the client and its translations.
    """
    if not url:
        return None
    private = getattr(user.profile, 'is_private', False)
    post = Post.objects.create(
        author=user, activity=kind, text='',
        audience=Post.Audience.FOLLOWERS if private else Post.Audience.PUBLIC,
    )
    PostMedia.objects.create(post=post, position=0, kind=PostMedia.Kind.IMAGE, url=url)
    return post
