"""Media uploads: the client sends bytes, the API returns a URL it can be trusted to render.

Files live on the storage backend (local /media in development, S3 in production); the
database only ever stores the resulting URL.
"""

import secrets

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .media import save_upload

MAX_BYTES = 150 * 1024 * 1024
IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'}
VIDEO_TYPES = {'video/mp4', 'video/webm', 'video/quicktime'}
# The suffix has to agree with the type the server just accepted. A client that
# re-encoded a PNG into JPEG keeps the old name, and a .png full of JPEG bytes is
# refused by the browser — see apps/common/media.py.
EXTENSIONS = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/avif': '.avif',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
}


def _kind(content_type):
    if content_type in IMAGE_TYPES:
        return 'image'
    if content_type in VIDEO_TYPES:
        return 'video'
    return None


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload(request):
    upload = request.FILES.get('file')
    if not upload:
        return Response({'detail': 'No file received.'}, status=400)
    kind = _kind(upload.content_type or '')
    if not kind:
        return Response({'detail': 'Only JPEG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV files are allowed.'}, status=400)
    if upload.size > MAX_BYTES:
        return Response({'detail': 'File is larger than 150 MB.'}, status=400)

    extension = EXTENSIONS[upload.content_type]
    name = f'uploads/{secrets.token_hex(12)}{extension}'.lower()
    path = save_upload(name, upload)
    url = request.build_absolute_uri(f'{settings.MEDIA_URL}{path}')
    return Response({'url': url, 'kind': kind, 'bytes': upload.size}, status=201)
