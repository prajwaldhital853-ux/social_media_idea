import base64
import json

from django.db.models import Q
from django.utils.dateparse import parse_datetime
from rest_framework.pagination import BasePagination
from rest_framework.response import Response


def encode_cursor(obj, field='created_at'):
    value = getattr(obj, field)
    payload = json.dumps([value.isoformat(), obj.pk], separators=(',', ':'))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')


def decode_cursor(raw):
    if not raw:
        return None
    try:
        padded = raw + '=' * (-len(raw) % 4)
        ts, pk = json.loads(base64.urlsafe_b64decode(padded))
        return parse_datetime(ts), int(pk)
    except (ValueError, TypeError):
        return None


class KeysetPagination(BasePagination):
    """Cursor pagination on (timestamp, id) descending — stable under inserts.

    `sort_field` names the timestamp the list really walks: posts page over
    `created_at`, an inbox over the last message, and so on.
    """

    page_size = 10

    def __init__(self, sort_field='created_at'):
        self.sort_field = sort_field

    def paginate_queryset(self, queryset, request, view=None):
        # `order=oldest` walks the same index in the other direction; the cursor
        # holds the same (timestamp, pk) pair either way.
        self.ascending = request.query_params.get('order') == 'oldest'
        if self.ascending:
            queryset = queryset.order_by(self.sort_field, 'pk')
        else:
            queryset = queryset.order_by(f'-{self.sort_field}', '-pk')
        cursor = decode_cursor(request.query_params.get('cursor'))
        if cursor:
            ts, pk = cursor
            step = 'gt' if self.ascending else 'lt'
            after = 'pk__gt' if self.ascending else 'pk__lt'
            queryset = queryset.filter(
                Q(**{f'{self.sort_field}__{step}': ts}) | Q(**{f'{self.sort_field}': ts, after: pk})
            )
        self.has_more = False
        rows = list(queryset[:self.page_size + 1])
        if len(rows) > self.page_size:
            self.has_more = True
            rows = rows[:self.page_size]
        self.last = rows[-1] if rows else None
        return rows

    def get_paginated_response(self, data):
        return Response({
            'results': data,
            'next_cursor': encode_cursor(self.last, self.sort_field) if self.has_more and self.last else None,
            'has_more': self.has_more,
        })

    def get_paginated_response_schema(self, schema):
        return schema