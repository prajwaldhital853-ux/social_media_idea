from django.urls import re_path

from .consumer import ChatConsumer

websocket_urlpatterns = [
    # Next's rewrite proxy normalizes away the trailing slash on the handshake
    # path, so both spellings have to route to the consumer.
    re_path(r'^ws/chat/(?P<username>[\w.@+-]+)/?$', ChatConsumer.as_asgi()),
]
