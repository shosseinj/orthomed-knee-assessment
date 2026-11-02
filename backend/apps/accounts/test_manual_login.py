from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import OTPChallenge, User
from .services import SMSDeliveryError


@override_settings(
    DEBUG=False, OTP_BACKEND="smsir", ENABLE_MOCK_OTP=False,
    OTP_MANUAL_CODE_HASH=make_password("17935"),
    ADMIN_REGISTRATION_PASSWORD_HASH="",
)
@patch("apps.accounts.services.get_sms_gateway")
class ManualLoginTests(TestCase):
    phone = "09123456789"

    def request_code(self):
        return APIClient().post("/api/v1/auth/otp/request/", {"phone_number": self.phone}, format="json")

    def verify(self, code="17935", role="patient"):
        return APIClient().post("/api/v1/auth/otp/verify/", {
            "phone_number": self.phone, "code": code, "entry_role": role,
        }, format="json")

    @patch("apps.accounts.services.secrets.randbelow", return_value=44321)
    def test_sms_is_still_sent_and_manual_code_signs_in_only_once(self, _random, gateway):
        User.objects.create_user(self.phone, role="patient", is_verified=True)
        response = self.request_code()
        gateway.return_value.send_otp.assert_called_once_with(self.phone, "54321")
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.data["sms_sent"])
        self.assertTrue(response.data["manual_code_enabled"])
        self.assertNotIn("17935", str(response.data))
        self.assertNotIn("OTP_MANUAL_CODE_HASH", str(response.data))
        signed_in = self.verify()
        self.assertEqual(signed_in.status_code, 200, signed_in.data)
        self.assertIn("access", signed_in.data)
        self.assertEqual(signed_in.data["user"]["role"], "patient")
        self.assertEqual(self.verify().status_code, 400)
        self.assertEqual(self.verify("54321").status_code, 400)

    @patch("apps.accounts.services.secrets.randbelow", return_value=44321)
    def test_sms_code_also_works_with_manual_mode_enabled(self, _random, gateway):
        User.objects.create_user(self.phone, role="patient", is_verified=True)
        self.request_code()
        self.assertEqual(self.verify("54321").status_code, 200)
        self.assertEqual(self.verify().status_code, 400)

    def test_delivery_failure_keeps_a_challenge_and_offers_manual_registration(self, gateway):
        gateway.return_value.send_otp.side_effect = SMSDeliveryError("provider unavailable")
        response = self.request_code()
        self.assertEqual(response.status_code, 202)
        self.assertFalse(response.data["sms_sent"])
        self.assertTrue(response.data["manual_code_enabled"])
        self.assertFalse(User.objects.exists())
        verified = self.verify()
        self.assertEqual(verified.status_code, 200, verified.data)
        self.assertTrue(verified.data["registration_required"])
        self.assertNotIn("access", verified.data)
        registered = APIClient().post("/api/v1/auth/register/", {
            "registration_token": verified.data["registration_token"], "role": "patient",
            "first_name": "سارا", "last_name": "محمدی",
            "national_code": "0013520822", "birth_date": "1990-01-01",
        }, format="json")
        self.assertEqual(registered.status_code, 201, registered.data)
        self.assertIn("access", registered.data)

    def test_manual_code_requires_a_request_and_is_bound_to_its_phone(self, gateway):
        self.assertEqual(self.verify().status_code, 400)
        self.request_code()
        self.phone = "09123456780"
        self.assertEqual(self.verify().status_code, 400)

    def test_manual_code_cannot_use_an_expired_or_exhausted_challenge(self, gateway):
        self.request_code()
        OTPChallenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.verify().status_code, 400)
        self.request_code()
        for _ in range(5):
            self.assertEqual(self.verify("00000").status_code, 400)
        self.assertEqual(self.verify().status_code, 400)

    def test_consuming_latest_request_cannot_reactivate_an_older_challenge(self, gateway):
        self.request_code()
        self.request_code()
        self.assertEqual(self.verify().status_code, 200)
        self.assertEqual(self.verify().status_code, 400)
        self.assertEqual(OTPChallenge.objects.filter(consumed_at__isnull=True).count(), 1)

    def test_manual_sign_in_still_requires_registration_for_another_role(self, gateway):
        user = User.objects.create_user(self.phone, role="patient", is_verified=True)
        self.request_code()
        result = self.verify(role="doctor")
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data["registration_required"])
        self.assertNotIn("access", result.data)
        user.refresh_from_db()
        self.assertEqual(user.role, "patient")
        self.assertFalse(user.role_registrations.filter(role="doctor").exists())

    def test_manual_code_does_not_bypass_admin_or_inactive_account_checks(self, gateway):
        user = User.objects.create_user(self.phone, role="patient", is_verified=True)
        self.request_code()
        self.assertEqual(self.verify(role="admin").status_code, 400)
        user.is_active = False
        user.save(update_fields=["is_active"])
        self.request_code()
        self.assertEqual(self.verify().status_code, 400)

    @override_settings(OTP_MANUAL_CODE_HASH="")
    @patch("apps.accounts.services.secrets.randbelow", return_value=44321)
    def test_empty_setting_disables_manual_sign_in(self, _random, gateway):
        response = self.request_code()
        self.assertFalse(response.data["manual_code_enabled"])
        self.assertEqual(self.verify().status_code, 400)
