from django.urls import path

from . import views

urlpatterns = [
    path('messages/inbox/', views.inbox),
    path('messages/<str:username>/', views.thread),
    path('messages/<str:username>/read/', views.mark_read),
]