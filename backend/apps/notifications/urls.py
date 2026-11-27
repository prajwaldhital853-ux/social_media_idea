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
    # The same three doors, mounted where a staff seat is allowed to be itself.
    # A seat that holds a job is deliberately read as nobody at every member
    # door, so without this the console's own browser can never file its address.
    path('admin/push/config/', views.push_config),
    path('admin/push/subscribe/', views.push_subscribe),
    path('admin/push/unsubscribe/', views.push_unsubscribe),
    path('notifications/<int:pk>/', views.notification_detail),
]