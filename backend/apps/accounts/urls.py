from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import AISettingsView, MeView, OTPRequestView, OTPVerifyView, PanelAccessView, PhoneCheckView
from .management_views import ManagedAccountListView, ManagedAccountReviewView

urlpatterns = [
    path("phone/check/", PhoneCheckView.as_view(), name="phone-check"),
    path("otp/request/", OTPRequestView.as_view(), name="otp-request"),
    path("otp/verify/", OTPVerifyView.as_view(), name="otp-verify"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("settings/ai/", AISettingsView.as_view(), name="ai-settings"),
    path("access/", PanelAccessView.as_view(), name="panel-access"),
    path("management/accounts/", ManagedAccountListView.as_view(), name="managed-accounts"),
    path("management/accounts/<uuid:pk>/", ManagedAccountReviewView.as_view(), name="managed-account-review"),
]
