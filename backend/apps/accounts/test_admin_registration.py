from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.core import signing
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from .models import User
from .services import issue_otp


TEST_PASSWORD = "Registration-Test-Password-123"


@override_settings(DEBUG=True, OTP_BACKEND="console", ENABLE_MOCK_OTP=True, MOCK_OTP_CODE="11111",
                   ADMIN_REGISTRATION_PASSWORD_HASH=make_password(TEST_PASSWORD))
class AdminRegistrationTests(TestCase):
    phone = "09123456789"
    identity = dict(first_name="Sara", last_name="Test", national_code="0013520822", birth_date="1990-01-01")

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def verify(self, code="11111", role="admin"):
        issue_otp(self.phone)
        return APIClient().post("/api/v1/auth/otp/verify/", {
            "phone_number": self.phone, "code": code, "entry_role": role,
        }, format="json")

    def register(self, token, **extra):
        return APIClient().post("/api/v1/auth/register/", {
            **self.identity, "role": "admin", "registration_token": token,
            "admin_password": TEST_PASSWORD, **extra,
        }, format="json")

    def client_for(self, response):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        return client

    def test_verified_phone_and_correct_password_create_an_admin_with_only_management_permission(self):
        verified = self.verify()
        self.assertEqual(verified.status_code, 200)
        self.assertTrue(verified.data["registration_required"])
        self.assertFalse(User.objects.exists())
        token = verified.data["registration_token"]
        payload = signing.loads(token, salt="accounts.phone-registration")
        self.assertEqual(payload["role"], "admin")
        self.assertNotIn("admin_password", payload)
        registered = self.register(token)
        self.assertEqual(registered.status_code, 201, registered.data)
        self.assertEqual(registered.data["user"]["role"], "admin")
        self.assertTrue(registered.data["user"]["can_manage_accounts"])
        self.assertNotIn(TEST_PASSWORD, str(registered.data))
        user = User.objects.get(phone_number=self.phone)
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.check_password(TEST_PASSWORD))
        self.assertNotEqual(user.password, TEST_PASSWORD)
        self.assertTrue(user.has_perm("accounts.manage_account_verifications"))
        self.assertFalse(user.has_perm("accounts.change_user"))
        self.assertEqual(set(user.role_registrations.values_list("role", flat=True)), {"admin"})
        client = self.client_for(registered)
        self.assertEqual(client.get("/api/v1/auth/management/accounts/").status_code, 200)
        self.assertEqual(client.get("/api/v1/cases/").status_code, 403)
        self.assertEqual(AccessToken(registered.data["access"])["active_role"], "admin")
        self.assertFalse(self.verify().data["registration_required"])
        self.assertEqual(self.register(token).status_code, 400)

    def test_wrong_or_missing_password_keeps_the_token_usable_and_creates_no_account(self):
        token = self.verify().data["registration_token"]
        for password in ("incorrect", ""):
            response = self.register(token, admin_password=password)
            self.assertEqual(response.status_code, 400)
            self.assertFalse(User.objects.exists())
            self.assertNotIn("access", response.data)
        response = APIClient().post("/api/v1/auth/register/", {
            **self.identity, "registration_token": token, "role": "admin",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("admin_password", response.data["errors"])
        self.assertEqual(self.register(token).status_code, 201)

    def test_patient_can_add_admin_after_password_verification_without_losing_patient_access(self):
        patient = User.objects.create_user(self.phone, role="patient", is_verified=True, **self.identity)
        patient_token = self.verify(role="patient")
        missing = self.verify()
        self.assertTrue(missing.data["registration_required"])
        self.assertIn("registration_profile", missing.data)
        self.assertFalse(User.objects.get(pk=patient.pk).is_staff)
        registered = self.register(missing.data["registration_token"])
        self.assertEqual(registered.status_code, 201, registered.data)
        patient.refresh_from_db()
        self.assertEqual(patient.role, "patient")
        self.assertTrue(patient.is_verified)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(set(patient.role_registrations.values_list("role", flat=True)), {"patient", "admin"})
        client = self.client_for(patient_token)
        self.assertEqual(client.get("/api/v1/cases/").status_code, 200)
        self.assertEqual(client.get("/api/v1/auth/management/accounts/").status_code, 403)
        self.assertEqual(self.client_for(registered).get("/api/v1/auth/management/accounts/").status_code, 200)

    def test_password_does_not_replace_phone_verification_or_allow_changing_a_token_role(self):
        with patch("apps.accounts.serializers.User.objects.filter") as lookup:
            response = self.verify(code="54321")
            lookup.assert_not_called()
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("registration_token", response.data)
        self.assertEqual(self.register("forged-token").status_code, 400)
        patient_token = self.verify(role="patient").data["registration_token"]
        self.assertEqual(self.register(patient_token).status_code, 400)
        response = self.register(patient_token, role="patient", is_staff=True, is_superuser=True)
        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get()
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.has_perm("accounts.manage_account_verifications"))

    def test_disabling_registration_blocks_outstanding_tokens_but_existing_admins_can_sign_in(self):
        token = self.verify().data["registration_token"]
        with override_settings(ADMIN_REGISTRATION_PASSWORD_HASH=""):
            self.assertEqual(self.verify().status_code, 400)
            self.assertEqual(self.register(token).status_code, 400)
        registered = self.register(token)
        self.assertEqual(registered.status_code, 201)
        with override_settings(ADMIN_REGISTRATION_PASSWORD_HASH=""):
            signed_in = self.verify()
            self.assertEqual(signed_in.status_code, 200)
            self.assertFalse(signed_in.data["registration_required"])

    def test_admin_password_attempts_are_rate_limited(self):
        token = self.verify().data["registration_token"]
        for _ in range(5):
            self.assertEqual(self.register(token, admin_password="incorrect").status_code, 400)
        self.assertEqual(self.register(token).status_code, 429)
        spoofed = APIClient().post("/api/v1/auth/register/", {
            **self.identity, "role": "admin", "registration_token": token, "admin_password": TEST_PASSWORD,
        }, format="json", HTTP_X_FORWARDED_FOR="192.0.2.1", HTTP_X_REAL_IP="192.0.2.2")
        self.assertEqual(spoofed.status_code, 429)
        self.assertFalse(User.objects.exists())

    def test_disabled_admin_registration_invalidates_existing_session(self):
        registered = self.register(self.verify().data["registration_token"])
        client = self.client_for(registered)
        user = User.objects.get()
        user.role_registrations.filter(role="admin").update(is_active=False)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 401)
        self.assertEqual(self.verify().status_code, 400)
