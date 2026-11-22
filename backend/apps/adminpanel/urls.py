from django.urls import path

from . import views_overview, views_review, views_session, views_staff

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
    path('admin/review/', views_review.review_queue),
    path('admin/review/<int:pk>/decide/', views_review.review_decide),
    path('admin/content/', views_review.content_shelf),
    path('admin/content/<str:kind>/<int:pk>/', views_review.content_action),
    path('admin/policy/', views_review.policy_lists),
    path('admin/policy/terms/', views_review.term_create),
    path('admin/policy/terms/<int:pk>/', views_review.term_update),
    path('admin/policy/categories/', views_review.category_create),
    path('admin/policy/categories/<int:pk>/', views_review.category_update),
    path('admin/notices/', views_review.notice_list),
    path('admin/notices/<int:pk>/withdraw/', views_review.notice_withdraw),
    path('notices/<str:kind>/<int:pk>/', views_review.public_notices),
]
