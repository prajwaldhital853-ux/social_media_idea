from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import PostViewSet, count_view, feed, share_post

router = DefaultRouter()
router.register('posts', PostViewSet, basename='post')

urlpatterns = [
    path('feed/', feed),
    path('posts/<int:pk>/share/', share_post),
    path('posts/<int:pk>/view/', count_view),
] + router.urls