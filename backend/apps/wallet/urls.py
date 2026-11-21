from django.urls import path

from . import views

urlpatterns = [
    path('wallet/', views.wallet_detail),
    path('wallet/requests/', views.coin_request_create),
    path('wallet/requests/list/', views.coin_request_list),
    path('wallet/requests/<int:pk>/<str:action>/', views.coin_request_review),
]