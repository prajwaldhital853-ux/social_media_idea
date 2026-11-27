from django.urls import path

from . import views

urlpatterns = [
    path('notifications/', views.notification_list),
    path('notifications/unread/', views.unread_count),
    path('notifications/read/', views.mark_read),
    path('notifications/stream/', views.notification_stream),
    path('notifications/push/config/', views.push_config),
    path('notifications/push/subscribe/', views.push_subscribe),
    path('notifications/push/unsubscribe/', views.push_unsubscribe),
    path('notifications/<int:pk>/', views.notification_detail),
]