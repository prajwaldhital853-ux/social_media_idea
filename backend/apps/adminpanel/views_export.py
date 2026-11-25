"""Contract 6.9: the five files a seat hands to an accountant, and the record of who took one.

Two doors on one screen. The read answers "what would this file contain", the row
counts, the column names, the window a date pair would cut, because a CSV you cannot
inspect before downloading is a CSV you end up apologising for afterwards. The write
builds it, and by default answers in JSON with the same numbers so the screen can
print them; with `?raw=1` it answers as the file itself, which is what the browser
saves to disk.

Every build writes an audit row of its own (`exports.py` does it in the same call
that streams the text), so this door is the one place the console hands out other
people's email addresses *and* says who did it. That is the promise 6.9 makes, and a
seat who only ever uses the screen's own history list still sees the whole story.
"""

from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import audit, exports, rbac

BAD_DATE = 'Give the dates as 2026-11-01, a whole table needs neither of them.'


def _window(request):
    """(since, until, the sentence to show instead), typed in a body or a query string."""
    posted = request.data if isinstance(getattr(request, 'data', None), dict) else {}

    def typed(name):
        return str(posted.get(name) or request.query_params.get(name) or '').strip()

    since_raw, until_raw = typed('since'), typed('until')
    since, until = exports.day_boundaries(since_raw, until_raw)
    if since_raw and since is None:
        return None, None, BAD_DATE
    if until_raw and until is None:
        return None, None, BAD_DATE
    return since, until, None


def _bad_pair(since, until):
    if since and until and since > until:
        return 'The first date is after the second, so the file would hold nothing.'
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('exports')
def export_index(request):
    """What each file would contain right now, and who last took one."""
    since, until, bad = _window(request)
    if bad:
        return Response({'detail': bad}, status=400)
    crossed = _bad_pair(since, until)
    if crossed:
        return Response({'detail': crossed}, status=400)
    return Response({
        'files': exports.index(since, until),
        'labels': [{'id': key, 'label': label, 'blurb': blurb} for key, (label, blurb) in exports.LABELS.items()],
        'window': {'since': since, 'until': until},
        'cap': exports.MAX_ROWS,
        'taken': [audit.line(item) for item in audit.queryset(action='export_csv')[:12]],
        'columns_of': {key: value for key, value in exports.COLUMNS.items()},
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('exports')
def export_build(request, dataset):
    """Build one file. JSON by default, the download itself with `?raw=1`."""
    since, until, bad = _window(request)
    if bad:
        return Response({'detail': bad}, status=400)
    crossed = _bad_pair(since, until)
    if crossed:
        return Response({'detail': crossed}, status=400)
    code, body = exports.build(request.user, dataset, since, until)
    if code != 200:
        return Response(body, status=code)
    if request.query_params.get('raw') not in ('1', 'true'):
        return Response(body)
    # The file, not a description of it: the header carries the name the desk showed,
    # so a seat who clicks Download gets `exposing-users-2026-11-01-to-2026-11-22.csv`
    # rather than a browser-invented `download.csv`.
    response = HttpResponse(body['csv'], content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{body["filename"]}"'
    response['X-Export-Rows'] = str(body['rows'])
    response['X-Export-Truncated'] = '1' if body['truncated'] else '0'
    response['X-Export-Detail'] = body['detail']
    return response
