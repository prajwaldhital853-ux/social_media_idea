from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ReactionViewSet, reactors, toggle_off

router = DefaultRouter()
router.register('reactions', ReactionViewSet, basename='reaction')

urlpatterns = [
    path('reactions/toggle/', toggle_off),
    path('reactions/people/', reactors),
] + router.urls