from django.urls import path

from . import views

urlpatterns = [
    path('promotions/', views.promotion_list),
    path('promotions/all/', views.promotion_queue),
    path('promotions/<int:pk>/track/', views.promotion_track),
    path('promotions/<int:pk>/', views.promotion_update),
    path('promotions/<int:pk>/<str:action>/', views.promotion_action),
]
