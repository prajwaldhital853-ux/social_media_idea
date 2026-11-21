from django.urls import path

from . import views

urlpatterns = [
    path('profiles/<str:username>/', views.profile_detail),
    path('users/', views.user_search),
]
