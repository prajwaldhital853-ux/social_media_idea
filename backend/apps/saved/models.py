from django.conf import settings
from django.db import models


class SavedPost(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='saved_posts')
    post = models.ForeignKey('posts.Post', on_delete=models.CASCADE, related_name='saved_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            # The unique pair stops a second save; it is keyed by post, so it
            # cannot serve the list a member opens — that reads by user, newest first.
            models.Index(fields=['user', '-created_at'], name='saved_post_user_newest'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['user', 'post'], name='one_save_per_user_post'),
        ]

    def __str__(self):
        return f'{self.user.username} saved {self.post_id}'


class SavedListing(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='saved_listings')
    listing = models.ForeignKey('marketplace.Listing', on_delete=models.CASCADE, related_name='saved_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at'], name='saved_listing_user_newest'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['user', 'listing'], name='one_save_per_user_listing'),
        ]

    def __str__(self):
        return f'{self.user.username} saved listing {self.listing_id}'