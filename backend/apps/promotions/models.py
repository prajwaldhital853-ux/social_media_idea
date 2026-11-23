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
    package = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    impressions = models.PositiveIntegerField(default=0)
    clicks = models.PositiveIntegerField(default=0)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-ends_at'], name='promo_running'),
        ]

    def __str__(self):
        return f'Promo {self.target_type}:{self.target_id} ({self.status})'


class PromoImpression(models.Model):
    """One paid card one person was actually shown, on the day it happened.

    `Promotion.impressions` is a tally, and a tally cannot answer the two
    questions the reach controls ask: has this person already had this campaign
    today, and has this campaign spent the audience its package promised. Each
    serve writes one row here, and the counter on the campaign is what these rows
    add up to — so a number a payer was charged for is a number that can be shown
    to have happened.
    """

    promotion = models.ForeignKey(Promotion, on_delete=models.CASCADE, related_name='impression_rows')
    viewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='promo_impressions',
    )
    day = models.DateField()
    served_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-served_at']
        constraints = [
            # One campaign reaches one person once a day: a second showing on the
            # same day is the repeat the desk sets a limit on, not reach.
            models.UniqueConstraint(
                fields=['promotion', 'viewer', 'day'], name='promo_once_per_person_per_day',
            ),
        ]
        indexes = [
            models.Index(fields=['viewer', '-day'], name='promo_seen_by_person'),
            models.Index(fields=['promotion', '-day'], name='promo_delivered_on'),
        ]

    def __str__(self):
        return f'Promo {self.promotion_id} shown to {self.viewer_id} on {self.day}'