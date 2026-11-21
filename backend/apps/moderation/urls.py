from django.urls import path

from . import views

urlpatterns = [
    path('moderation/reports/', views.reports),
    path('moderation/reports/<int:pk>/<str:action>/', views.report_action),
    path('moderation/users/', views.user_directory),
    path('moderation/users/<str:username>/suspend/', views.suspend),
    path('moderation/users/<str:username>/reinstate/', views.reinstate),
    path('moderation/audit/', views.audit_log),
]
