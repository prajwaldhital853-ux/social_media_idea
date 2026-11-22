"""
ASGI config for exposing project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.1/howto/deployment/asgi/
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')

django_asgi = get_asgi_application()

from channels.security.websocket import OriginValidator  # noqa: E402
from apps.messages.routing import websocket_urlpatterns  # noqa: E402

from django.conf import settings  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi,
    'websocket': OriginValidator(
        URLRouter(websocket_urlpatterns),
        settings.WS_ORIGINS,
    ),
})
