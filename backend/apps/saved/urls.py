from django.urls import path

from . import views

urlpatterns = [
    path('saved/posts/', views.saved_posts),
    path('saved/posts/<int:post_id>/', views.unsave_post),
    path('saved/listings/', views.saved_listings),
    path('saved/listings/<int:listing_id>/', views.unsave_listing),
]