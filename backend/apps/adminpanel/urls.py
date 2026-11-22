from django.urls import path

from . import views_overview, views_session, views_staff

urlpatterns = [
    path('admin/session/', views_session.admin_session),
    path('admin/session/login/', views_session.admin_login),
    path('admin/session/verify/', views_session.admin_verify),
    path('admin/session/logout/', views_session.admin_logout),
    path('admin/overview/', views_overview.admin_overview),
    path('admin/analytics/promotions/', views_overview.admin_promotion_analytics),
    path('admin/permissions/', views_staff.permission_catalog),
    path('admin/staff/', views_staff.staff_directory),
    path('admin/staff/grant/', views_staff.staff_grant),
    path('admin/staff/<str:username>/', views_staff.staff_update),
    path('admin/staff/<str:username>/revoke/', views_staff.staff_revoke),
    path('admin/staff/<str:username>/reset-two-factor/', views_staff.staff_reset_two_factor),
]
