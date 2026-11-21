import base64
import json

from django.db.models import Q
from django.utils.dateparse import parse_datetime
from rest_framework.pagination import BasePagination
from rest_framework.response import Response


def encode_cursor(obj):
    payload = json.dumps([obj.created_at.isoformat(), obj.pk], separators=(',', ':'))
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
    """Cursor pagination on (created_at, id) descending — stable under inserts."""

    page_size = 10

    def paginate_queryset(self, queryset, request, view=None):
        queryset = queryset.order_by('-created_at', '-pk')
        cursor = decode_cursor(request.query_params.get('cursor'))
        if cursor:
            ts, pk = cursor
            queryset = queryset.filter(Q(created_at__lt=ts) | Q(created_at=ts, pk__lt=pk))
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
            'next_cursor': encode_cursor(self.last) if self.has_more and self.last else None,
            'has_more': self.has_more,
        })

    def get_paginated_response_schema(self, schema):
        return schema