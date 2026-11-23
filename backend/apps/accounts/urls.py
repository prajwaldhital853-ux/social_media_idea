from django.urls import path

from . import views

urlpatterns = [
    path('auth/signup/', views.signup),
    path('auth/login/', views.login),
    path('auth/otp/', views.otp_verify),
    path('auth/otp/resend/', views.otp_resend),
    path('auth/refresh/', views.refresh),
    path('auth/logout/', views.logout),
    path('auth/unlock/', views.unlock_request),
    path('auth/unlock/confirm/', views.unlock_confirm),
    path('auth/google/', views.google),
    path('auth/me/', views.me),
    path('auth/delete/request/', views.account_delete_request),
    path('auth/delete/confirm/', views.account_delete_confirm),
]