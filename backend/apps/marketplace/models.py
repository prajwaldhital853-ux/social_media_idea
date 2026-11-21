from django.conf import settings
from django.db import models


class Listing(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        SOLD = 'sold', 'Sold'
        REMOVED = 'removed', 'Removed'

    seller = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='listings')
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='NPR')
    category = models.CharField(max_length=80, blank=True)
    condition = models.CharField(max_length=40, blank=True)
    location = models.CharField(max_length=120, blank=True)
    image_url = models.URLField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at'], name='listing_newest_first'),
            models.Index(fields=['status', 'category', '-created_at'], name='listing_status_category'),
            models.Index(fields=['seller', '-created_at'], name='listing_seller_newest'),
        ]

    def __str__(self):
        return self.title


class ListingImage(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name='images')
    url = models.URLField()
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['position']