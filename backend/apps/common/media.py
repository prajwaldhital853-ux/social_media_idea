"""Media files served by Django itself, with the byte ranges browsers need.

A deployed API has no web server in front of it, so /media comes out of this
view. Handing the file over wholesale is not enough: a ``<video>`` only seeks
when the server answers Range requests, and reels are seeked by tapping.
"""

import os
import re

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.http import Http404, HttpResponse, StreamingHttpResponse
from django.utils._os import safe_join

# Only the types the upload view accepts, so nothing served from here can be a
# script or a document the browser would run on this origin.
CONTENT_TYPES = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime',
}

RANGE = re.compile(r'^bytes=(\d*)-(\d*)$')
CHUNK = 256 * 1024


def _range(header, size):
    """Start, end and status for one Range header; the whole file when absent."""
    match = RANGE.match(header or '')
    if not match or not (match.group(1) or match.group(2)):
        return 0, size - 1, 200
    start_text, end_text = match.groups()
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    else:
        # bytes=-N is the last N bytes, which is how a browser probes an mp4
        # trailer when the moov box sits at the end of the file.
        start = max(0, size - int(end_text))
        end = size - 1
    if start >= size or end >= size or end < start:
        return None, None, 416
    return start, end, 206


def _read(handle, length):
    try:
        while length > 0:
            chunk = handle.read(min(CHUNK, length))
            if not chunk:
                return
            length -= len(chunk)
            yield chunk
    finally:
        handle.close()


def serve_media(request, path):
    if request.method not in ('GET', 'HEAD'):
        raise Http404
    try:
        target = safe_join(str(settings.MEDIA_ROOT), path)
    except (ValueError, TypeError, SuspiciousOperation):
        raise Http404
    content_type = CONTENT_TYPES.get(os.path.splitext(target or '')[-1].lower())
    if not target or not content_type or not os.path.isfile(target):
        raise Http404

    size = os.path.getsize(target)
    start, end, status = _range(request.headers.get('Range'), size)
    if status == 416:
        response = HttpResponse(status=416)
        response['Content-Range'] = f'bytes */{size}'
        return response

    length = end - start + 1
    handle = open(target, 'rb')
    handle.seek(start)
    if request.method == 'HEAD':
        handle.close()
        response = HttpResponse(b'', status=status, content_type=content_type)
    else:
        response = StreamingHttpResponse(_read(handle, length), status=status, content_type=content_type)
    response['Content-Length'] = str(length)
    response['Content-Disposition'] = 'inline'
    response['Accept-Ranges'] = 'bytes'
    response['Cache-Control'] = 'public, max-age=86400'
    response['X-Content-Type-Options'] = 'nosniff'
    if status == 206:
        response['Content-Range'] = f'bytes {start}-{end}/{size}'
    return response
