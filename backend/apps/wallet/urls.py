from django.urls import path

from . import views

urlpatterns = [
    path('wallet/', views.wallet_detail),
    path('wallet/requests/', views.coin_request_create),
    path('wallet/requests/list/', views.coin_request_list),
    # `proof` is a literal segment and is named before the id routes below, so a
    # buyer answering an ask cannot be read as a staff decision being taken.
    path('wallet/requests/<int:pk>/proof/', views.coin_proof_resubmit),
    path('wallet/requests/<int:pk>/<str:action>/', views.coin_request_review),
]