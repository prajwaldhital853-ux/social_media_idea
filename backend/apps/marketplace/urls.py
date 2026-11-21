from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ListingViewSet, categories, set_status

router = DefaultRouter()
router.register('marketplace', ListingViewSet, basename='listing')

urlpatterns = [
    path('marketplace/categories/', categories),
    path('marketplace/<int:pk>/<str:action>/', set_status),
] + router.urls