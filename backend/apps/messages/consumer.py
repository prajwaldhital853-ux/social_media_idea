"""The DM thread socket: live messages, typing indicators and read receipts.

Cookies carry the same JWT the REST API uses, so the handshake is first-party
through the Next.js proxy. The in-memory layer keeps this single-process — when
the app ever scales out, the channel layer becomes Redis and nothing here moves.
"""

import asyncio

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.utils import timezone

from apps.accounts.auth import decode_token
from apps.accounts.models import User

from .presence import mark_watching, stop_watching


def _cookie_user(scope):
    raw = ''
    for name, value in scope.get('headers') or []:
        if name == b'cookie':
            raw = value.decode('latin-1')
            break
    parts = dict(p.split('=', 1) for p in raw.split('; ') if '=' in p)
    token = parts.get('exposing_access', '')
    if not token:
        return None
    try:
        payload = decode_token(token, 'access')
    except Exception:
        return None
    return User.objects.filter(pk=int(payload['sub']), is_active=True).first()


class ChatConsumer(AsyncJsonWebsocketConsumer):
    # Guards against one account pinning every slot (and the sockets behind it).
    sockets_per_user = {}

    async def connect(self):
        self.user = await asyncio.to_thread(_cookie_user, self.scope)
        if self.user is None or self.user.is_suspended:
            await self.close(code=4401)
            return
        username = self.scope['url_route']['kwargs']['username']
        self.other = await asyncio.to_thread(
            User.objects.filter(username=username, is_active=True).first
        )
        if not self.other or self.other.pk == self.user.pk:
            await self.close(code=4404)
            return
        held = self.sockets_per_user.get(self.user.pk, 0)
        if held >= settings.WS_SOCKETS_PER_USER:
            await self.close(code=4429)
            return
        self.sockets_per_user[self.user.pk] = held + 1
        lo, hi = sorted((self.user.pk, self.other.pk))
        self.group = f'chat.{lo}.{hi}'
        await self.channel_layer.group_add(self.group, self.channel_name)
        # The socket is a watcher too: while one is open the reader is here, and
        # a message that lands on this screen needs no bell to announce it.
        await asyncio.to_thread(mark_watching, self.user.pk, self.other.pk)
        await self.accept()
        await self.send_json({'kind': 'ready', 'thread': username})

    async def disconnect(self, code):
        if getattr(self, 'group', None):
            await self.channel_layer.group_discard(self.group, self.channel_name)
        if getattr(self, 'other', None):
            await asyncio.to_thread(stop_watching, self.user.pk, self.other.pk)
        held = self.sockets_per_user.get(getattr(self, 'user', None) and self.user.pk)
        if held is not None:
            if held <= 1:
                self.sockets_per_user.pop(self.user.pk, None)
            else:
                self.sockets_per_user[self.user.pk] = held - 1

    async def receive_json(self, content):
        # A burst of frames from one socket is either a broken client or abuse;
        # either way the socket stops being ours to serve.
        self.frames = getattr(self, 'frames', 0) + 1
        if self.frames > 120:
            await self.close(code=4429)
            return
        kind = content.get('type')
        if kind == 'ping':
            await self.send_json({'kind': 'pong'})
        elif kind == 'typing':
            await self.channel_layer.group_send(self.group, {
                'type': 'chat.typing', 'by': self.user.pk, 'name': self.user.username,
            })
        elif kind == 'read':
            count = await asyncio.to_thread(self._mark_read)
            await self.channel_layer.group_send(self.group, {
                'type': 'chat.read', 'by': self.user.pk, 'read': count,
            })

    def _mark_read(self):
        from apps.messages.models import Conversation
        conversation = Conversation.objects.filter(
            participants=self.user).filter(participants=self.other).first()
        if not conversation:
            return 0
        conversation.messages.exclude(sender=self.user).filter(delivered_at__isnull=True).update(
            delivered_at=timezone.now())
        return conversation.messages.exclude(sender=self.user).filter(
            read_at__isnull=True).update(read_at=timezone.now())

    async def chat_message(self, event):
        await self.send_json({'kind': 'message', 'message': event['message']})

    async def chat_typing(self, event):
        if event['by'] != self.user.pk:
            await self.send_json({'kind': 'typing', 'by': event['name']})

    async def chat_read(self, event):
        if event['by'] != self.user.pk:
            await self.send_json({'kind': 'read', 'read': event['read']})


def broadcast_message(message, participant_ids):
    """The REST send pushes the row to whoever holds the thread open."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    # Deferred: views imports this module, so the serializer comes along only
    # at call time to keep the import cycle from closing.
    from .views import MessageSerializer

    lo, hi = sorted(participant_ids)
    async_to_sync(get_channel_layer().group_send)(
        f'chat.{lo}.{hi}',
        {'type': 'chat.message', 'message': MessageSerializer(message).data},
    )


def broadcast_read(reader_id, participant_ids, count):
    """A receipt that flips via REST still belongs on the open thread's wire."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    lo, hi = sorted(participant_ids)
    async_to_sync(get_channel_layer().group_send)(
        f'chat.{lo}.{hi}',
        {'type': 'chat.read', 'by': reader_id, 'read': count},
    )
