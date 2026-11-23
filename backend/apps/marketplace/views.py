from django.db.models import Q
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated, IsAuthenticatedOrReadOnly, SAFE_METHODS
from rest_framework.response import Response

from .models import Listing, ListingImage


class ListingImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingImage
        fields = ['id', 'url', 'position']
        read_only_fields = ['id']


class ListingSerializer(serializers.ModelSerializer):
    seller_username = serializers.CharField(source='seller.username', read_only=True)
    seller_name = serializers.CharField(source='seller.profile.display_name', read_only=True)
    images = ListingImageSerializer(many=True, required=False)

    class Meta:
        model = Listing
        fields = [
            'id', 'seller', 'seller_username', 'seller_name', 'title', 'description',
            'price', 'currency', 'category', 'condition', 'location', 'image_url',
            'status', 'created_at', 'images',
        ]
        read_only_fields = ['id', 'seller', 'status', 'created_at']

    def validate_price(self, value):
        if value < 1:
            raise serializers.ValidationError('Price must be at least 1.')
        return value

    def validate_images(self, value):
        if len(value) > 5:
            raise serializers.ValidationError('At most 5 photos per listing.')
        return value

    def validate_description(self, value):
        if len((value or '').split()) > 500:
            raise serializers.ValidationError('Description must be 500 words or fewer.')
        return value

    def create(self, validated_data):
        images = validated_data.pop('images', [])
        listing = Listing.objects.create(**validated_data)
        for position, item in enumerate(images):
            ListingImage.objects.create(listing=listing, position=position, **item)
        return listing

    def update(self, instance, validated_data):
        images = validated_data.pop('images', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if images is not None:
            instance.images.all().delete()
            for position, item in enumerate(images):
                ListingImage.objects.create(listing=instance, position=position, **item)
        return instance


class IsSellerOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.method in SAFE_METHODS or obj.seller_id == request.user.id


class ListingViewSet(viewsets.ModelViewSet):
    serializer_class = ListingSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, IsSellerOrReadOnly]

    def get_queryset(self):
        qs = Listing.objects.select_related('seller__profile').prefetch_related('images')
        user = self.request.user
        params = self.request.query_params
        removed = Q(status=Listing.Status.REMOVED)
        if getattr(self, 'action', None) == 'retrieve':
            # A deleted ad still answers its own link, for its seller and for the
            # moderator who took it down, so both read "not available" instead of
            # a load error.
            if not (user.is_authenticated and user.is_staff):
                stranger = removed if not user.is_authenticated else removed & ~Q(seller=user)
                qs = qs.exclude(stranger)
        elif not (user.is_authenticated and user.is_staff and params.get('status')):
            # The grid is a page of live offers for everyone: the seller who
            # deleted an ad and the staff who moderates it both reach the archive
            # on purpose, and nobody gets a deleted row padding an ordinary page.
            qs = qs.exclude(removed)
        if params.get('seller'):
            qs = qs.filter(seller__username=params['seller'])
        if params.get('mine') and user.is_authenticated:
            qs = qs.filter(seller=user)
        if params.get('category'):
            qs = qs.filter(category__iexact=params['category'])
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        if params.get('location'):
            qs = qs.filter(location__icontains=params['location'])
        if params.get('min'):
            qs = qs.filter(price__gte=params['min'])
        if params.get('max'):
            qs = qs.filter(price__lte=params['max'])
        if params.get('q'):
            needle = params['q']
            qs = qs.filter(Q(title__icontains=needle) | Q(description__icontains=needle))
        return qs

    def perform_create(self, serializer):
        serializer.save(seller=self.request.user)


@api_view(['GET'])
@permission_classes([AllowAny])
def categories(request):
    values = Listing.objects.exclude(status='removed').exclude(category='').values_list('category', flat=True).distinct()
    return Response({'results': sorted(values)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def set_status(request, pk, action):
    listing = Listing.objects.filter(pk=pk, seller=request.user).first()
    if not listing:
        return Response({'detail': 'Not your listing.'}, status=404)
    if action == 'sold' and listing.status == 'active':
        listing.status = Listing.Status.SOLD
    elif action == 'relist' and listing.status == 'sold':
        listing.status = Listing.Status.ACTIVE
    elif action == 'remove' and listing.status in (Listing.Status.ACTIVE, Listing.Status.SOLD):
        # Deleting your own ad is a status change, not a row delete: a buyer who
        # already saved or messaged about it still needs the history to resolve.
        listing.status = Listing.Status.REMOVED
    else:
        return Response({'detail': 'Invalid transition.'}, status=400)
    listing.save(update_fields=['status'])
    return Response(ListingSerializer(listing).data)