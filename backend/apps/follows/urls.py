from django.urls import path

from . import views

urlpatterns = [
    path('follows/', views.follow),
    path('follows/requests/', views.requests_list),
    path('follows/requests/<int:pk>/<str:action>/', views.request_action),
    path('follows/mutuals/', views.mutuals),
    path('follows/state/<str:username>/', views.state),
    path('follows/<str:username>/', views.unfollow),
    path('users/<str:username>/followers/', views.followers),
    path('users/<str:username>/following/', views.following),
]