from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.pagination import KeysetPagination
from apps.marketplace.models import Listing
from apps.marketplace.views import ListingSerializer
from apps.posts.serializers import PostSerializer
from apps.posts.views import mark_promoted, visible_posts

from .models import SavedListing, SavedPost


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def saved_posts(request):
    # visible_posts is the one rule for "may this reader read this post": a save
    # made while following someone does not survive an unfollow, and the payload
    # would hand over the text and media of a follower-only post either way.
    readable = visible_posts(request.user)
    if request.method == 'POST':
        post = get_object_or_404(readable, pk=request.data.get('post'))
        try:
            with transaction.atomic():
                SavedPost.objects.create(user=request.user, post=post)
        except IntegrityError:
            return Response({'detail': 'Already saved.'}, status=400)
        return Response({'saved': True}, status=status.HTTP_201_CREATED)
    qs = SavedPost.objects.filter(
        user=request.user, post__status='live', post__in=readable
    ).select_related('post__author__profile').prefetch_related('post__media')
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    data = PostSerializer([r.post for r in rows], many=True, context={'request': request}).data
    mark_promoted(data)
    return paginator.get_paginated_response(data)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def unsave_post(request, post_id):
    deleted, _ = SavedPost.objects.filter(user=request.user, post_id=post_id).delete()
    if not deleted:
        return Response({'detail': 'Not saved.'}, status=404)
    return Response({'saved': False})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def saved_listings(request):
    if request.method == 'POST':
        listing = get_object_or_404(Listing, pk=request.data.get('listing'))
        try:
            with transaction.atomic():
                SavedListing.objects.create(user=request.user, listing=listing)
        except IntegrityError:
            return Response({'detail': 'Already saved.'}, status=400)
        return Response({'saved': True}, status=status.HTTP_201_CREATED)
    qs = (SavedListing.objects.filter(user=request.user)
          .exclude(listing__status='removed')
          .select_related('listing__seller__profile')
          .prefetch_related('listing__images'))
    paginator = KeysetPagination()
    rows = paginator.paginate_queryset(qs, request)
    data = ListingSerializer([r.listing for r in rows], many=True).data
    return paginator.get_paginated_response(data)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def unsave_listing(request, listing_id):
    deleted, _ = SavedListing.objects.filter(user=request.user, listing_id=listing_id).delete()
    if not deleted:
        return Response({'detail': 'Not saved.'}, status=404)
    return Response({'saved': False})