from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import User


@receiver(post_save, sender=User)
def ensure_profile_wallet(sender, instance, created, **kwargs):
    if not created:
        return
    from apps.profiles.models import Profile
    from apps.wallet.models import Wallet
    Profile.objects.get_or_create(user=instance, defaults={'display_name': instance.get_full_name() or instance.username})
    Wallet.objects.get_or_create(user=instance)