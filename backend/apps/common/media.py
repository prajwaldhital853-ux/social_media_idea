"""Media files served by Django itself, with the byte ranges browsers need.

A deployed API has no web server in front of it, so /media comes out of this
view. Handing the file over wholesale is not enough: a ``<video>`` only seeks
when the server answers Range requests, and reels are seeked by tapping. Nor is
answering them cheaply: each byte leaves through a request worker, so the
response carries validators that let a rewatch cost nothing.
"""

import os
import re

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.http import (
    Http404, HttpResponse, HttpResponseNotModified, StreamingHttpResponse,
)
from django.utils._os import safe_join
from django.utils.http import http_date, parse_http_date

# Only the types the upload view accepts, so nothing served from here can be a
# script or a document the browser would run on this origin.
CONTENT_TYPES = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime',
}

RANGE = re.compile(r'^bytes=(\d*)-(\d*)$')
# Every byte leaves through a worker, so the chunk size is a scheduling cost as
# much as a buffer: 256 KB meant eighty reads and eighty yields for one seek of
# a 20 MB clip.
CHUNK = 1024 * 1024
# A re-upload lands under a new name, and the ETag below is mtime and size, so
# a clip the browser still holds cannot be a stale one.
MAX_AGE = 86400


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


def _etag(stat):
    """Identity of one file version, taken from its stat rather than its bytes."""
    return f'"m{stat.st_mtime_ns:x}-s{stat.st_size:x}"'


def _tag(value):
    value = value.strip()
    return value[2:] if value.startswith('W/') else value


def _fresh(request, etag, mtime):
    """Whether the client's copy still matches, so no byte has to be read."""
    inm = request.headers.get('If-None-Match')
    if inm:
        # If-None-Match wins over If-Modified-Since (RFC 7232 §6), which is why
        # this returns rather than falling through.
        return any(_tag(candidate) in ('*', _tag(etag)) for candidate in inm.split(','))
    since = parse_http_date(request.headers.get('If-Modified-Since') or '')
    # Last-Modified carries whole seconds, so the comparison happens there too.
    return since is not None and int(mtime) <= since


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
    try:
        stat = os.stat(target)
    except OSError:
        raise Http404

    size = stat.st_size
    etag = _etag(stat)
    if _fresh(request, etag, stat.st_mtime):
        # A rewatch of a cached reel used to read the file again. A 304 must not
        # repeat the entity headers, so it gets its own short response.
        response = HttpResponseNotModified()
        response['Cache-Control'] = f'public, max-age={MAX_AGE}'
        response['ETag'] = etag
        response['Last-Modified'] = http_date(stat.st_mtime)
        return response

    start, end, status = _range(request.headers.get('Range'), size)
    if status == 416:
        response = HttpResponse(status=416)
        response['Content-Range'] = f'bytes */{size}'
        return response

    length = end - start + 1
    handle = open(target, 'rb')
    try:
        handle.seek(start)
        if request.method == 'HEAD':
            # Nothing streams from this response, so nothing else closes it.
            handle.close()
            response = HttpResponse(b'', status=status, content_type=content_type)
        else:
            response = StreamingHttpResponse(_read(handle, length), status=status, content_type=content_type)
    except Exception:
        # _read's own finally only runs once the generator starts, which covers
        # a client that hangs up mid-clip; everything else lands here.
        handle.close()
        raise
    response['Content-Length'] = str(length)
    response['Content-Disposition'] = 'inline'
    response['Accept-Ranges'] = 'bytes'
    response['Cache-Control'] = f'public, max-age={MAX_AGE}'
    response['ETag'] = etag
    response['Last-Modified'] = http_date(stat.st_mtime)
    response['X-Content-Type-Options'] = 'nosniff'
    if status == 206:
        response['Content-Range'] = f'bytes {start}-{end}/{size}'
    return response
