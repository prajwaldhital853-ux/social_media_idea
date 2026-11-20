from rest_framework.routers import DefaultRouter

from .views import ReactionViewSet

router = DefaultRouter()
router.register('reactions', ReactionViewSet, basename='reaction')

urlpatterns = router.urls