"""Mail sent over HTTPS, because Render closes the SMTP ports.

Free Render web services drop outbound traffic to ports 25, 465 and 587, so an
SMTP conversation started from there is a socket that never opens: the
TimeoutError in the service log, and a member waiting for a code that was never
posted. Resend answers on 443 like every other web API, which is the one port
that gets through.

`urllib`, not `requests`: this runs on the mail thread, and a provider switch
should not have to wait for a dependency to install on the next deploy.
"""

import base64
import json
import urllib.error
import urllib.request

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail.backends.base import BaseEmailBackend

RESEND_URL = 'https://api.resend.com/emails'


class MailError(Exception):
    """The provider said no, or was not reachable at all."""


def attachment_part(attachment):
    """One attachment as the provider wants it: the name, the type and the bytes.

    Django carries two shapes here and they are not the same object. A tuple is
    `(filename, content, mimetype)`; a `MIMEImage` — which is how the brand mark
    travels — is a mail part that answers `__getitem__` with a *header*, so
    indexing it at 0 asks the parser for a header named `0`. Reading it as a
    tuple is what made every branded letter die before it reached the provider.
    """
    if isinstance(attachment, tuple):
        fields = list(attachment) + [None, None, None]
        filename, content, mimetype = fields[0], fields[1], fields[2]
        raw = content if isinstance(content, bytes) else str(content or '').encode()
        content_id = ''
    else:
        filename = attachment.get_filename() or 'attachment'
        raw = attachment.get_payload(decode=True) or b''
        mimetype = attachment.get_content_type()
        # `content_id` is the provider's own field for an inline picture, and the
        # angle brackets Django puts around the header are not part of the id.
        content_id = str(attachment.get('Content-ID') or '').strip().strip('<>')
    return {
        'content': base64.b64encode(raw).decode(),
        'filename': filename,
        'content_type': mimetype or 'application/octet-stream',
        **({'content_id': content_id} if content_id else {}),
    }


def payload(message):
    """The Resend body for one Django message.

    Django's own shape carries a subtype and a list of alternatives where Resend
    wants two optional strings, so the text of an HTML mail is not thrown away.
    """
    html = message.body if message.content_subtype == 'html' else None
    text = None if html else message.body
    for body, mimetype in getattr(message, 'alternatives', []):
        if mimetype == 'text/html':
            html = html or body
        elif mimetype == 'text/plain':
            text = text or body
    out = {
        'from': message.from_email,
        'to': list(message.to),
        'subject': message.subject,
    }
    if text is not None:
        out['text'] = text
    if html is not None:
        out['html'] = html
    if message.cc:
        out['cc'] = list(message.cc)
    if message.bcc:
        out['bcc'] = list(message.bcc)
    if message.reply_to:
        out['reply_to'] = ', '.join(message.reply_to)
    # Django moved the constructor argument to an attribute with a different name.
    headers = getattr(message, 'headers', None) or getattr(message, 'extra_headers', None)
    if headers:
        out['headers'] = dict(headers)
    parts = [attachment_part(attachment) for attachment in message.attachments]
    if parts:
        out['attachments'] = parts
    return {key: value for key, value in out.items() if value not in (None, '', [], {})}


class EmailBackend(BaseEmailBackend):
    """POSTs each message to Resend's API. `RESEND_API_KEY` is the only setting it needs."""

    def __init__(self, *args, api_key=None, url=None, timeout=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.api_key = getattr(settings, 'RESEND_API_KEY', '') if api_key is None else api_key
        self.url = url or getattr(settings, 'RESEND_API_URL', '') or RESEND_URL
        self.timeout = getattr(settings, 'EMAIL_TIMEOUT', 10) if timeout is None else timeout

    def send_messages(self, messages):
        if not self.api_key:
            raise ImproperlyConfigured(
                'EMAIL_BACKEND points at the Resend API but RESEND_API_KEY is empty, so nothing can be sent.'
            )
        sent = 0
        for message in messages:
            request = urllib.request.Request(
                self.url,
                data=json.dumps(payload(message)).encode(),
                method='POST',
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json',
                    # Cloudflare sits in front of the API and drops requests carrying
                    # the default interpreter signature, which leaves the mail thread
                    # with a 403 and no word from Resend about what it disliked.
                    'User-Agent': 'Exposing/1.0 (Django mail backend)',
                    'Accept': 'application/json',
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    if response.status >= 400:
                        raise MailError(f'Resend answered {response.status}.')
            except urllib.error.HTTPError as err:
                if self.fail_silently:
                    continue
                # The provider's own sentence is the only thing that explains a
                # rejected sender, and it is not in any log this side of the call.
                raise MailError(f'Resend answered {err.code}: {err.read().decode(errors="replace")[:300]}') from err
            except (urllib.error.URLError, OSError, TimeoutError) as err:
                if self.fail_silently:
                    continue
                raise MailError(f'Could not reach Resend: {err}') from err
            sent += len(message.recipients())
        return sent
