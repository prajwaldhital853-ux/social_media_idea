from django.urls import path

from . import views

urlpatterns = [
    path('notifications/', views.notification_list),
    path('notifications/unread/', views.unread_count),
    path('notifications/read/', views.mark_read),
    path('notifications/stream/', views.notification_stream),
]