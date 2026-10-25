from unittest.mock import patch

from django.core import signing
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import OTPChallenge, User
from .services import issue_otp


@override_settings(DEBUG=True, OTP_BACKEND="console", ENABLE_MOCK_OTP=True, MOCK_OTP_CODE="11111")
class VerifiedRegistrationTests(TestCase):
    phone = "09123456789"
    identity = {"first_name": "سارا", "last_name": "محمدی", "national_code": "0013520822", "birth_date": "1990-01-01"}

    def verify(self, code="11111"):
        return self.client.post("/api/v1/auth/otp/verify/", {"phone_number": self.phone, "code": code}, content_type="application/json")

    def register(self, token, **extra):
        return APIClient().post("/api/v1/auth/register/", {**self.identity, "registration_token": token, **extra}, format="json")

    def test_unknown_phone_is_verified_before_registration_and_creates_no_early_account(self):
        with patch("apps.accounts.views.User.objects.filter") as lookup:
            response = APIClient().post("/api/v1/auth/otp/request/", {"phone_number": self.phone}, format="json")
            lookup.assert_not_called()
        self.assertEqual(response.status_code, 202)
        self.assertNotIn("is_registered", response.data)
        self.assertFalse(User.objects.exists())
        verified = self.verify()
        self.assertEqual(verified.status_code, 200)
        self.assertTrue(verified.data["registration_required"])
        self.assertNotIn("access", verified.data)
        self.assertFalse(User.objects.exists())
        self.assertIsNotNone(OTPChallenge.objects.get().consumed_at)
        registered = self.register(verified.data["registration_token"])
        self.assertEqual(registered.status_code, 201, registered.data)
        self.assertIn("access", registered.data)
        self.assertEqual(registered.data["user"]["phone_number"], self.phone)

    def test_existing_user_signs_in_without_registration_or_profile_changes(self):
        user = User.objects.create_user(self.phone, first_name="Existing", role=User.Role.DOCTOR)
        issue_otp(self.phone)
        response = self.verify()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["registration_required"])
        self.assertNotIn("registration_token", response.data)
        self.assertIn("access", response.data)
        user.refresh_from_db()
        self.assertEqual(user.first_name, "Existing")
        self.assertEqual(user.role, User.Role.DOCTOR)

    def test_invalid_code_never_looks_up_an_account(self):
        issue_otp(self.phone)
        with patch("apps.accounts.serializers.User.objects.filter") as lookup:
            response = self.verify("54321")
            lookup.assert_not_called()
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("registration_required", response.data)
        self.assertNotIn("registration_token", response.data)

    def test_registration_requires_a_valid_unexpired_verification_token(self):
        for token in ("", "tampered-token", signing.dumps({"phone_number": self.phone}, salt="wrong-purpose")):
            with self.subTest(token=token):
                self.assertEqual(self.register(token).status_code, 400)
        issue_otp(self.phone)
        token = self.verify().data["registration_token"]
        with patch("django.core.signing.TimestampSigner.timestamp", return_value="1"):
            expired = signing.dumps({"phone_number": self.phone}, salt="accounts.phone-registration")
        self.assertEqual(self.register(expired).status_code, 400)
        self.assertFalse(User.objects.exists())
        self.assertEqual(self.register(token).status_code, 201)

    def test_registration_token_cannot_change_phone_or_be_reused_to_sign_in(self):
        issue_otp(self.phone)
        token = self.verify().data["registration_token"]
        response = self.register(token, phone_number="09998887766")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["user"]["phone_number"], self.phone)
        replay = self.register(token)
        self.assertEqual(replay.status_code, 400)
        self.assertNotIn("access", replay.data)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(self.verify().status_code, 400)

    def test_identity_validation_can_be_corrected_without_another_sms(self):
        issue_otp(self.phone)
        token = self.verify().data["registration_token"]
        invalid = self.register(token, national_code="1111111111")
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(User.objects.exists())
        self.assertEqual(self.register(token).status_code, 201)

    def test_old_phone_lookup_endpoint_is_removed(self):
        self.assertEqual(APIClient().post("/api/v1/auth/phone/check/", {"phone_number": self.phone}, format="json").status_code, 404)
