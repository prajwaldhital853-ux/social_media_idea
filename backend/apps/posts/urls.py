from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import PostViewSet, feed

router = DefaultRouter()
router.register('posts', PostViewSet, basename='post')

urlpatterns = [
    path('feed/', feed),
] + router.urls