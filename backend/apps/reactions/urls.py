from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ReactionViewSet, toggle_off

router = DefaultRouter()
router.register('reactions', ReactionViewSet, basename='reaction')

urlpatterns = [
    path('reactions/toggle/', toggle_off),
] + router.urls