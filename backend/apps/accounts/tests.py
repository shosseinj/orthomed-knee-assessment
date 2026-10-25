import json
import tempfile
from unittest.mock import patch
from datetime import timedelta
from pathlib import Path

from django.test import RequestFactory, TestCase, override_settings
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework.test import APIClient

from .access_audit import AccessEventKind, record_access
from .models import OTPChallenge, User
from .serializers import OTPVerifySerializer
from .services import issue_otp
from .validators import normalize_national_code


@override_settings(DEBUG=True, OTP_BACKEND="console", ENABLE_MOCK_OTP=True, MOCK_OTP_PREFIX="0950", MOCK_OTP_CODE="11111")
class OTPFlowTests(TestCase):
    def test_development_otp_creates_patient_and_tokens(self):
        issue_otp("09501234567")
        serializer = OTPVerifySerializer(data={
            "phone_number": "09501234567",
            "code": "11111",
            "first_name": "سارا",
            "last_name": "محمدی",
            "national_code": "۰۰۱۳۵۲۰۸۲۲",
            "birth_date": "1990-01-01",
            "role": "patient",
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        result = serializer.save()
        self.assertIn("access", result)
        self.assertTrue(User.objects.get(phone_number="09501234567").is_verified)
        self.assertEqual(result["user"]["national_code"], "0013520822")
        self.assertEqual(result["user"]["birth_date"], "1990-01-01")

    def test_insurance_registration_requires_admin_approval(self):
        issue_otp("09501234568")
        serializer = OTPVerifySerializer(data={
            "phone_number": "09501234568", "code": "11111", "role": "insurance",
            "first_name": "مینا", "last_name": "احمدی", "organization_name": "بیمه نمونه",
            "national_code": "0084575948", "birth_date": "1985-06-12",
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        user = User.objects.get(phone_number="09501234568")
        self.assertEqual(user.role, User.Role.INSURANCE)
        self.assertFalse(user.is_verified)
        self.assertEqual(user.organization_name, "بیمه نمونه")

    def test_development_code_works_for_regular_mobile_numbers(self):
        user = User.objects.create_user("09121234569", role=User.Role.PATIENT)
        issue_otp(user.phone_number)
        serializer = OTPVerifySerializer(data={"phone_number": user.phone_number, "code": "11111"})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    @patch("apps.accounts.services.get_sms_gateway")
    def test_mock_prefix_never_calls_sms_gateway(self, get_gateway):
        issue_otp("09509999999")
        get_gateway.assert_not_called()

    @override_settings(DEBUG=False, ENABLE_MOCK_OTP=True, OTP_BACKEND="smsir")
    @patch("apps.accounts.services.secrets.randbelow", return_value=44321)
    @patch("apps.accounts.services.get_sms_gateway")
    def test_production_uses_provider_and_rejects_development_code(self, get_gateway, _random):
        from .services import verify_otp
        issue_otp("09508888888")
        get_gateway.return_value.send_otp.assert_called_once_with("09508888888", "54321")
        self.assertFalse(verify_otp("09508888888", "11111"))
        self.assertTrue(verify_otp("09508888888", "54321"))
        response = APIClient().post("/api/v1/auth/phone/check/", {"phone_number": "09508888888"}, format="json")
        self.assertFalse(response.data["is_mock"])
        self.assertNotIn("development_code", response.data)

    def test_phone_check_routes_existing_and_new_users(self):
        User.objects.create_user("09501111111", role=User.Role.PATIENT)
        client = APIClient()
        existing = client.post("/api/v1/auth/phone/check/", {"phone_number": "09501111111"}, format="json")
        new = client.post("/api/v1/auth/phone/check/", {"phone_number": "09502222222"}, format="json")
        self.assertTrue(existing.data["is_registered"])
        self.assertFalse(new.data["is_registered"])
        self.assertTrue(new.data["is_mock"])

    def test_registration_requires_valid_unique_national_code_and_birth_date(self):
        issue_otp("09503333333")
        payload = {
            "phone_number": "09503333333", "code": "11111",
            "first_name": "علی", "last_name": "رضایی",
        }
        missing = OTPVerifySerializer(data=payload)
        self.assertFalse(missing.is_valid())
        self.assertIn("national_code", missing.errors)

        invalid = OTPVerifySerializer(data={**payload, "national_code": "1111111111", "birth_date": "1990-01-01"})
        self.assertFalse(invalid.is_valid())
        self.assertIn("national_code", invalid.errors)
        self.assertTrue(OTPChallenge.objects.latest("created_at").is_usable)

        future = OTPVerifySerializer(data={**payload, "national_code": "0013520822", "birth_date": str(timezone.localdate() + timedelta(days=1))})
        self.assertFalse(future.is_valid())
        self.assertIn("birth_date", future.errors)

        User.objects.create_user("09120000000", national_code="0013520822")
        duplicate = OTPVerifySerializer(data={**payload, "national_code": "0013520822", "birth_date": "1990-01-01"})
        self.assertFalse(duplicate.is_valid())
        self.assertIn("national_code", duplicate.errors)
        self.assertTrue(OTPChallenge.objects.latest("created_at").is_usable)

    def test_patient_can_edit_profile_but_not_phone_or_national_code(self):
        patient = User.objects.create_user(
            "09120000001", role=User.Role.PATIENT, national_code="0013520822", birth_date="1990-01-01",
        )
        client = APIClient()
        client.force_authenticate(patient)
        response = client.patch("/api/v1/auth/me/", {
            "first_name": "سارا", "last_name": "محمدی", "birth_date": "1988-04-03",
            "phone_number": "09129999999", "national_code": "0084575948",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        patient.refresh_from_db()
        self.assertEqual(patient.first_name, "سارا")
        self.assertEqual(str(patient.birth_date), "1988-04-03")
        self.assertEqual(patient.phone_number, "09120000001")
        self.assertEqual(patient.national_code, "0013520822")

        doctor = User.objects.create_user("09120000002", role=User.Role.DOCTOR)
        client.force_authenticate(doctor)
        self.assertEqual(client.patch("/api/v1/auth/me/", {"first_name": "X"}, format="json").status_code, 403)

    def test_persian_and_arabic_digits_are_accepted(self):
        self.assertEqual(normalize_national_code("۰۰۱۳۵۲۰۸۲۲"), "0013520822")
        self.assertEqual(normalize_national_code("٠٠١٣٥٢٠٨٢٢"), "0013520822")


@override_settings(
    ACCESS_AUDIT_PHONE_NUMBER="09198071351",
    ACCESS_AUDIT_TRUST_PROXY_IP=False,
    GEOIP_CITY_DB_PATH="",
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    },
)
class AccessAuditTests(TestCase):
    def setUp(self):
        audit_directory = tempfile.TemporaryDirectory()
        self.addCleanup(audit_directory.cleanup)
        self.audit_file = Path(audit_directory.name) / "access-audit.jsonl"
        audit_settings = override_settings(ACCESS_AUDIT_LOG_PATH=self.audit_file)
        audit_settings.enable()
        self.addCleanup(audit_settings.disable)
        self.tracked = User.objects.create_user("09198071351", first_name="مدیر")
        self.other = User.objects.create_user("09120000000", first_name="کاربر")

    def read_events(self):
        if not self.audit_file.exists():
            return []
        return [json.loads(line) for line in self.audit_file.read_text(encoding="utf-8").splitlines()]

    def test_only_tracked_account_is_told_to_report_panel_views(self):
        client = APIClient()
        client.force_authenticate(self.tracked)
        self.assertTrue(client.get("/api/v1/auth/me/").data["audit_access"])
        client.force_authenticate(self.other)
        self.assertFalse(client.get("/api/v1/auth/me/").data["audit_access"])

    @override_settings(ACCESS_AUDIT_MAX_BYTES=1024)
    def test_log_stays_bounded_and_keeps_recent_complete_events(self):
        for index in range(20):
            request = RequestFactory().get(f"/admin/test/{index}/", HTTP_USER_AGENT="Test browser")
            self.assertTrue(record_access(self.tracked, AccessEventKind.ADMIN_VIEW, request))

        events = self.read_events()
        self.assertLessEqual(self.audit_file.stat().st_size, 1024)
        self.assertGreater(len(events), 0)
        self.assertLess(len(events), 20)
        self.assertEqual(events[-1]["path"], "/admin/test/19/")
        self.assertNotEqual(events[0]["path"], "/admin/test/0/")

    @patch("apps.accounts.access_audit.approximate_location", side_effect=RuntimeError("lookup failed"))
    def test_unexpected_audit_failure_does_not_break_otp_login(self, _lookup):
        OTPChallenge.objects.create(
            phone_number=self.tracked.phone_number,
            code_hash=make_password("12345"),
            expires_at=timezone.now() + timedelta(minutes=2),
        )
        with self.assertLogs("apps.accounts.access_audit", level="ERROR"):
            response = APIClient().post(
                "/api/v1/auth/otp/verify/",
                {"phone_number": self.tracked.phone_number, "code": "12345"},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.read_events(), [])

    @patch("apps.accounts.access_audit._append_bounded", side_effect=OSError("disk full"))
    def test_file_write_failure_does_not_break_panel_or_admin(self, _append):
        client = APIClient()
        client.force_authenticate(self.tracked)
        with self.assertLogs("apps.accounts.access_audit", level="ERROR"):
            panel = client.post("/api/v1/auth/access/", {"path": "/dashboard"}, format="json")
        self.assertEqual(panel.status_code, 204)

        self.tracked.set_password("safe-test-password")
        self.tracked.is_staff = True
        self.tracked.is_superuser = True
        self.tracked.save()
        with self.assertLogs("apps.accounts.access_audit", level="ERROR"):
            login = self.client.post(
                "/admin/login/?next=/admin/",
                {"username": self.tracked.phone_number, "password": "safe-test-password", "next": "/admin/"},
            )
            admin_page = self.client.get("/admin/")
        self.assertEqual(login.status_code, 302)
        self.assertEqual(admin_page.status_code, 200)
        self.assertEqual(self.read_events(), [])

    def test_successful_otp_login_is_logged_but_failed_attempt_is_not(self):
        OTPChallenge.objects.create(
            phone_number=self.tracked.phone_number,
            code_hash=make_password("12345"),
            expires_at=timezone.now() + timedelta(minutes=2),
        )
        client = APIClient()
        success = client.post(
            "/api/v1/auth/otp/verify/",
            {"phone_number": self.tracked.phone_number, "code": "12345"},
            format="json", REMOTE_ADDR="198.51.100.17", HTTP_USER_AGENT="Test Browser/1.0",
        )
        self.assertEqual(success.status_code, 200)
        event = self.read_events()[0]
        self.assertEqual(event["kind"], AccessEventKind.PANEL_LOGIN)
        self.assertEqual(event["ip_address"], "198.51.100.17")
        self.assertEqual(event["user_agent"], "Test Browser/1.0")
        self.assertEqual(event["phone_number"], "09198071351")
        self.assertIn("occurred_at", event)
        self.assertNotIn("12345", json.dumps(event))

        failed = client.post(
            "/api/v1/auth/otp/verify/",
            {"phone_number": self.tracked.phone_number, "code": "00000"}, format="json",
        )
        self.assertEqual(failed.status_code, 400)
        self.assertEqual(len(self.read_events()), 1)

    def test_panel_views_are_targeted_and_duplicate_remounts_are_coalesced(self):
        client = APIClient()
        client.force_authenticate(self.tracked)
        payload = {"path": "/dashboard", "client_timezone": "Asia/Tehran"}
        first = client.post("/api/v1/auth/access/", payload, format="json", REMOTE_ADDR="198.51.100.17")
        second = client.post("/api/v1/auth/access/", payload, format="json", REMOTE_ADDR="198.51.100.17")
        self.assertEqual(first.status_code, 204)
        self.assertEqual(second.status_code, 204)
        self.assertEqual(len(self.read_events()), 1)
        self.assertEqual(self.read_events()[0]["client_timezone"], "Asia/Tehran")

        client.post("/api/v1/auth/access/", {"path": "/profile"}, format="json")
        self.assertEqual(len(self.read_events()), 2)
        self.assertEqual(client.post("/api/v1/auth/access/", {"path": "https://bad.example/?token=secret"}, format="json").status_code, 400)

        client.force_authenticate(self.other)
        self.assertEqual(client.post("/api/v1/auth/access/", payload, format="json").status_code, 204)
        self.assertEqual(len(self.read_events()), 2)

    @override_settings(ACCESS_AUDIT_TRUST_PROXY_IP=True)
    def test_only_configured_real_ip_header_is_trusted(self):
        client = APIClient()
        client.force_authenticate(self.tracked)
        client.post(
            "/api/v1/auth/access/", {"path": "/dashboard"}, format="json",
            REMOTE_ADDR="172.18.0.2", HTTP_X_REAL_IP="203.0.113.9",
            HTTP_X_FORWARDED_FOR="8.8.8.8, 203.0.113.9",
        )
        self.assertEqual(self.read_events()[0]["ip_address"], "203.0.113.9")

    def test_admin_login_and_html_page_view_are_logged(self):
        self.tracked.set_password("safe-test-password")
        self.tracked.is_staff = True
        self.tracked.is_superuser = True
        self.tracked.save()
        login_response = self.client.post(
            "/admin/login/?next=/admin/",
            {"username": self.tracked.phone_number, "password": "safe-test-password", "next": "/admin/"},
            REMOTE_ADDR="198.51.100.22",
        )
        self.assertEqual(login_response.status_code, 302)
        response = self.client.get("/admin/", REMOTE_ADDR="198.51.100.22")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {event["kind"] for event in self.read_events()},
            {AccessEventKind.ADMIN_LOGIN, AccessEventKind.ADMIN_VIEW},
        )

@override_settings(DEBUG=True, OTP_BACKEND="console", ENABLE_MOCK_OTP=True, MOCK_OTP_CODE="11111")
class DevelopmentOTPTests(TestCase):
    @patch("apps.accounts.services.get_sms_gateway")
    def test_request_returns_development_hint_for_any_valid_mobile_without_sms(self, get_gateway):
        for phone in ("09123456789", "09501234567"):
            response = APIClient().post("/api/v1/auth/otp/request/", {"phone_number": phone}, format="json")
            self.assertEqual(response.status_code, 202)
            self.assertTrue(response.data["is_mock"])
            self.assertEqual(response.data["development_code"], "11111")
        get_gateway.assert_not_called()

    def test_development_code_requires_challenge_and_remains_one_time(self):
        from .services import verify_otp
        phone = "09123456789"
        self.assertFalse(verify_otp(phone, "11111"))
        issue_otp(phone)
        self.assertFalse(verify_otp(phone, "12345"))
        self.assertTrue(verify_otp(phone, "11111"))
        self.assertFalse(verify_otp(phone, "11111"))

    def test_expired_development_challenge_is_rejected(self):
        from .services import verify_otp
        phone = "09123456789"
        challenge = issue_otp(phone)
        challenge.expires_at = timezone.now() - timedelta(seconds=1)
        challenge.save()
        self.assertFalse(verify_otp(phone, "11111"))

    @override_settings(ENABLE_MOCK_OTP=False)
    @patch("apps.accounts.services.secrets.randbelow", return_value=44321)
    @patch("apps.accounts.services.get_sms_gateway")
    def test_disabling_mock_mode_restores_real_codes(self, get_gateway, _random):
        from .services import verify_otp
        phone = "09123456789"
        response = APIClient().post("/api/v1/auth/otp/request/", {"phone_number": phone}, format="json")
        self.assertFalse(response.data["is_mock"])
        self.assertNotIn("development_code", response.data)
        get_gateway.return_value.send_otp.assert_called_once_with(phone, "54321")
        self.assertFalse(verify_otp(phone, "11111"))
