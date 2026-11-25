from django.urls import path

from . import (views_alerts, views_audit, views_bell, views_coins, views_export, views_limits, views_overview,
               views_people, views_promotions, views_review, views_safety, views_session, views_staff,
               views_welcome)

urlpatterns = [
    path('admin/session/', views_session.admin_session),
    path('admin/session/login/', views_session.admin_login),
    path('admin/session/verify/', views_session.admin_verify),
    path('admin/session/password/', views_session.admin_set_password),
    path('admin/session/logout/', views_session.admin_logout),
    # Contract: a seat recovers its own password here, from the address on the
    # seat. They are named before `logout` is not required, the literal segments
    # sit beside the id routes on purpose, since none of these is a username.
    path('admin/session/forgot/', views_session.admin_forgot),
    path('admin/session/forgot/resend/', views_session.admin_forgot_resend),
    path('admin/session/recovery/', views_session.admin_recovery),
    path('admin/overview/', views_overview.admin_overview),
    path('admin/analytics/promotions/', views_overview.admin_promotion_analytics),
    path('admin/analytics/alerts/', views_overview.admin_alert_feed),
    # Contract 6.11: the bell. Readable by any seat, which rows a seat is shown is
    # decided per notice, by the permission the event was announced against.
    path('admin/bell/', views_bell.bell_desk),
    path('admin/bell/read/', views_bell.bell_read),
    path('admin/permissions/', views_staff.permission_catalog),
    path('admin/staff/', views_staff.staff_directory),
    path('admin/staff/grant/', views_staff.staff_grant),
    path('admin/staff/create/', views_staff.staff_create),
    path('admin/staff/<str:username>/', views_staff.staff_update),
    path('admin/staff/<str:username>/revoke/', views_staff.staff_revoke),
    path('admin/staff/<str:username>/reset-two-factor/', views_staff.staff_reset_two_factor),
    path('admin/review/', views_review.review_queue),
    # Contract 6.3. `case` is a literal segment listed before the id routes, so
    # one target opened as a page never reads as a report being decided.
    path('admin/review/case/', views_review.review_case),
    path('admin/review/<int:pk>/decide/', views_review.review_decide),
    path('admin/content/', views_review.content_shelf),
    path('admin/content/<str:kind>/<int:pk>/', views_review.content_action),
    path('admin/policy/', views_review.policy_lists),
    path('admin/policy/terms/', views_review.term_create),
    path('admin/policy/terms/<int:pk>/', views_review.term_update),
    path('admin/policy/categories/', views_review.category_create),
    path('admin/policy/categories/<int:pk>/', views_review.category_update),
    path('admin/notices/', views_review.notice_list),
    path('admin/notices/attach/', views_review.notice_create),
    path('admin/notices/<int:pk>/withdraw/', views_review.notice_withdraw),
    path('notices/<str:kind>/<int:pk>/', views_review.public_notices),
    # Contract 6.7. The two receipt doors are named `receipt`, not `proof`, so that
    # `/5/proof/` stays readable as the decision "ask for more proof" rather than
    # being matched as a file route that only takes GET.
    path('admin/coins/desk/', views_coins.coin_desk),
    path('admin/coins/qr/', views_coins.coin_qr_upload),
    path('admin/coins/ledger/', views_coins.coin_ledger),
    path('admin/coins/ledger/adjust/', views_coins.coin_adjust),
    path('admin/coins/<int:pk>/receipt/', views_coins.coin_proof),
    path('admin/coins/<int:pk>/receipt-link/', views_coins.coin_proof_link),
    path('admin/coins/<int:pk>/', views_coins.coin_detail),
    path('admin/coins/', views_coins.coin_queue),
    path('admin/coins/<int:pk>/<str:action>/', views_coins.coin_decide),
    path('coins/pricing/', views_coins.coin_pricing_public),
    path('admin/people/', views_people.people_directory),
    path('admin/people/<str:username>/', views_people.person_detail),
    path('admin/people/<str:username>/suspend/', views_people.person_suspend),
    path('admin/people/<str:username>/reinstate/', views_people.person_reinstate),
    path('admin/people/<str:username>/verify/', views_people.person_verify),
    path('admin/people/<str:username>/warn/', views_people.person_warn),
    path('admin/people/<str:username>/clear-flags/', views_people.person_clear_flags),
    path('admin/people/<str:username>/delete/', views_people.person_delete),
    path('admin/welcome/', views_welcome.welcome_desk),
    path('admin/welcome/mail-test/', views_welcome.welcome_mail_test),
    path('welcome/', views_welcome.welcome_public),
    # Contract 6.8. `packages` and `algorithm` are literal segments, so they are
    # listed before the id routes and stay readable as desks rather than campaigns.
    path('admin/promotions/packages/', views_promotions.package_desk),
    path('admin/promotions/algorithm/', views_promotions.algorithm_desk),
    path('admin/promotions/<int:pk>/', views_promotions.promotion_detail),
    path('admin/promotions/', views_promotions.promotion_queue),
    path('admin/promotions/<int:pk>/<str:action>/', views_promotions.promotion_decide),
    path('promotions/config/', views_promotions.promotion_config),
    # Contract 6.9. `admin/spam/` is the desk, `spam/config/` is what the member site
    # reads from it, and the three lists below are what the pile and the checks
    # produce. The exports door answers as a file, not as JSON, so a seat gets the
    # CSV the contract promises rather than a screen's worth of text to copy.
    path('admin/spam/', views_safety.spam_desk),
    path('admin/spam/flags/', views_safety.flagged),
    path('spam/config/', views_safety.spam_config),
    path('admin/alerts/', views_alerts.alert_desk),
    path('admin/alerts/scan/', views_alerts.alert_scan),
    path('admin/alerts/thresholds/', views_alerts.alert_thresholds),
    path('admin/alerts/<int:pk>/mark/', views_alerts.alert_mark),
    path('admin/audit/', views_audit.audit_trail),
    path('admin/exports/', views_export.export_index),
    path('admin/exports/<str:dataset>/', views_export.export_build),
    # Contract 6.10: the size of one post, and the open door the composer reads it from.
    path('admin/limits/', views_limits.limits_desk),
    path('limits/config/', views_limits.limits_config),
]
