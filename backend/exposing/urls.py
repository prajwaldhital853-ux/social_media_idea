from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

from apps.common import sync, uploads
from apps.common.config import client_config
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(['GET'])
@permission_classes([AllowAny])
def client_meta(request):
    """Everything the SPA needs to render forms before anyone signs in."""
    return Response(client_config())


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/meta/', client_meta),
    path('api/sync/', sync.sync),
    path('api/uploads/', uploads.upload),
    path('api/', include('apps.accounts.urls')),
    path('api/', include('apps.profiles.urls')),
    path('api/', include('apps.follows.urls')),
    path('api/', include('apps.posts.urls')),
    path('api/', include('apps.comments.urls')),
    path('api/', include('apps.reactions.urls')),
    path('api/', include('apps.saved.urls')),
    path('api/', include('apps.messages.urls')),
    path('api/', include('apps.marketplace.urls')),
    path('api/', include('apps.wallet.urls')),
    path('api/', include('apps.notifications.urls')),
    path('api/', include('apps.promotions.urls')),
    path('api/', include('apps.moderation.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
