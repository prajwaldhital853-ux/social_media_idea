from django.urls import path

from . import stream, views

urlpatterns = [
    path('messages/inbox/', views.inbox),
    path('messages/<str:username>/', views.thread),
    path('messages/<str:username>/conversation/', views.delete_conversation),
    # Plain async view, not a DRF one: a streamed response is written a frame at
    # a time and cannot pass through a renderer.
    path('messages/<str:username>/stream/', stream.thread_stream),
    path('messages/<str:username>/typing/', views.typing),
    path('messages/<str:username>/read/', views.mark_read),
]
