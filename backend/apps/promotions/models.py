from django.conf import settings
from django.db import models


class Promotion(models.Model):
    class Target(models.TextChoices):
        POST = 'post', 'Post'
        LISTING = 'listing', 'Listing'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        ACTIVE = 'active', 'Active'
        PAUSED = 'paused', 'Paused'
        ENDED = 'ended', 'Ended'

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='promotions')
    target_type = models.CharField(max_length=10, choices=Target.choices, default=Target.POST)
    target_id = models.CharField(max_length=64)
    category = models.CharField(max_length=80, blank=True)
    age_min = models.PositiveSmallIntegerField(default=13)
    age_max = models.PositiveSmallIntegerField(default=65)
    country = models.CharField(max_length=80, blank=True)
    city = models.CharField(max_length=80, blank=True)
    budget = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Promo {self.target_type}:{self.target_id} ({self.status})'