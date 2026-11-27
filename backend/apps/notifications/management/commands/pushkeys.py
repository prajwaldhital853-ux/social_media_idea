"""Print a fresh VAPID pair for the environment.

The keys are what tells a browser's push service that this server, and not
anyone who found the endpoint string, is allowed to write to it. One pair for
the whole platform: a second pair silently invalidates every subscription the
first one made, because a browser's subscription is bound to the key that
created it. Generate once, paste into Render, do not regenerate on a whim.
"""

import base64

from django.core.management.base import BaseCommand
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


class Command(BaseCommand):
    help = 'Print a VAPID key pair to put in VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.'

    def handle(self, *args, **options):
        key = ec.generate_private_key(ec.SECP256R1())
        # The raw 32-byte scalar rather than `private_bytes(Raw, Raw)`, which
        # this version of cryptography refuses for an EC key.
        private = key.private_numbers().private_value.to_bytes(32, 'big')
        public = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
        )
        self.stdout.write('VAPID_PUBLIC_KEY=' + b64url(public))
        self.stdout.write('VAPID_PRIVATE_KEY=' + b64url(private))
        self.stdout.write(
            self.style.WARNING(
                'Replacing a pair that is already in use orphans every browser that '
                'subscribed under the old one. Set both at the same time.'
            )
        )
