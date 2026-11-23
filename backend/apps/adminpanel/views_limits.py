"""Contract 6.10 — the size of one post, as a setting instead of a constant.

Two doors on one screen. The desk is the six numbers the contract names and the
sentence for each; the open door is what the member site is told, with nobody signed
in, so a seat can prove the save reached further than the browser that typed it.

What the platform refuses *today* is printed beside it, read from the code that does
the refusing: the upload endpoint has one ceiling — 150 MB per file, whatever the
file turns out to be — and that is the only size the API has ever checked by itself.
A number here bigger than that is a real rule the composer will honour and a file the
server still turns away, so the desk says so instead of waiting for a 400 to explain
it.
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import limits, rbac


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('post_limits')
def limits_desk(request):
    """Characters, photos and video length — read, or moved and published."""
    if request.method == 'GET':
        return Response(limits.desk(request.staff_account))
    code, body = limits.write(request.user, request.data)
    return Response(body, status=code)


@api_view(['GET'])
@permission_classes([AllowAny])
def limits_config(request):
    """What a composer is told before it lets anybody attach a file."""
    return Response(limits.public_config())
