from unittest.mock import patch

import requests
from django.contrib.auth.hashers import check_password
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import OTPChallenge, User


@override_settings(
    DEBUG=True,
    OTP_BACKEND="smsir",
    ENABLE_MOCK_OTP=False,
    SMSIR_API_KEY="test-private-smsir-key",
    SMSIR_TEMPLATE_ID="123456",
    SMSIR_CODE_PARAMETER="PARAMETER1",
)
class SMSIRLoginTests(TestCase):
    phone = "09123456789"

    def request_code(self):
        return APIClient().post(
            "/api/v1/auth/otp/request/", {"phone_number": self.phone}, format="json",
        )

    @patch("apps.accounts.services.secrets.randbelow", return_value=44321)
    @patch("apps.accounts.services.requests.post")
    def test_smsir_request_and_one_time_sign_in(self, post, _random):
        post.return_value.json.return_value = {"status": 1, "data": {"messageId": 42}}
        User.objects.create_user(self.phone, role=User.Role.PATIENT, is_verified=True)

        response = self.request_code()

        self.assertEqual(response.status_code, 202)
        self.assertFalse(response.data["is_mock"])
        self.assertNotIn("development_code", response.data)
        post.assert_called_once_with(
            "https://api.sms.ir/v1/send/verify",
            headers={
                "Content-Type": "application/json",
                "Accept": "text/plain",
                "x-api-key": "test-private-smsir-key",
            },
            json={
                "mobile": self.phone,
                "templateId": 123456,
                "parameters": [{"name": "PARAMETER1", "value": "54321"}],
            },
            timeout=10,
        )
        challenge = OTPChallenge.objects.get(phone_number=self.phone)
        self.assertNotEqual(challenge.code_hash, "54321")
        self.assertTrue(check_password("54321", challenge.code_hash))

        client = APIClient()
        payload = {"phone_number": self.phone, "code": "54321"}
        signed_in = client.post("/api/v1/auth/otp/verify/", payload, format="json")
        self.assertEqual(signed_in.status_code, 200, signed_in.data)
        self.assertIn("access", signed_in.data)
        self.assertEqual(client.post("/api/v1/auth/otp/verify/", payload, format="json").status_code, 400)

    @patch("apps.accounts.services.requests.post")
    def test_provider_failures_do_not_leave_a_challenge_or_expose_secrets(self, post):
        failures = (
            requests.Timeout("private provider details"),
            requests.ConnectionError("private provider details"),
            requests.HTTPError("private provider details"),
            ValueError("invalid JSON"),
            {"status": 0, "message": "private provider details"},
            {"status": 109, "message": "invalid template"},
            {},
            [],
        )
        for failure in failures:
            with self.subTest(failure=failure):
                post.reset_mock()
                post.return_value.raise_for_status.side_effect = None
                post.return_value.json.side_effect = None
                if isinstance(failure, requests.RequestException):
                    post.return_value.raise_for_status.side_effect = failure
                elif isinstance(failure, ValueError):
                    post.return_value.json.side_effect = failure
                else:
                    post.return_value.json.return_value = failure
                response = self.request_code()
                self.assertEqual(response.status_code, 503)
                self.assertIn("errors", response.data)
                self.assertNotIn("private provider details", str(response.data))
                self.assertNotIn("test-private-smsir-key", str(response.data))
                self.assertFalse(OTPChallenge.objects.exists())

    @patch("apps.accounts.services.requests.post")
    def test_http_error_logs_provider_status_without_private_details(self, post):
        post.return_value.status_code = 400
        post.return_value.raise_for_status.side_effect = requests.HTTPError("private provider details")
        post.return_value.json.return_value = {
            "status": 120,
            "message": f"private provider details test-private-smsir-key {self.phone}",
        }
        with self.assertLogs("apps.accounts.services", level="ERROR") as logs:
            response = self.request_code()
        self.assertEqual(response.status_code, 503)
        output = " ".join(logs.output)
        self.assertIn("HTTP 400, provider status 120", output)
        for private in ("private provider details", "test-private-smsir-key", self.phone):
            self.assertNotIn(private, output)
        self.assertFalse(OTPChallenge.objects.exists())

    @patch("apps.accounts.services.requests.post")
    def test_network_error_logs_exception_type_without_private_details(self, post):
        post.side_effect = requests.Timeout("private provider details test-private-smsir-key")
        with self.assertLogs("apps.accounts.services", level="ERROR") as logs:
            response = self.request_code()
        self.assertEqual(response.status_code, 503)
        output = " ".join(logs.output)
        self.assertIn("Timeout", output)
        self.assertNotIn("private provider details", output)
        self.assertNotIn("test-private-smsir-key", output)
        self.assertFalse(OTPChallenge.objects.exists())

    @patch("apps.accounts.services.requests.post")
    def test_missing_or_invalid_configuration_does_not_call_provider(self, post):
        for config in (
            {"SMSIR_API_KEY": ""},
            {"SMSIR_TEMPLATE_ID": ""},
            {"SMSIR_TEMPLATE_ID": "not-a-number"},
            {"SMSIR_TEMPLATE_ID": "0"},
            {"SMSIR_TEMPLATE_ID": "-1"},
            {"SMSIR_CODE_PARAMETER": ""},
        ):
            with self.subTest(config=config), override_settings(**config):
                response = self.request_code()
                self.assertEqual(response.status_code, 503)
                self.assertFalse(OTPChallenge.objects.exists())
        post.assert_not_called()

    @patch("apps.accounts.services.requests.post")
    def test_smsir_never_exposes_the_development_code_with_mock_mode_disabled(self, post):
        post.return_value.json.return_value = {"status": 1}
        self.phone = "09501234567"
        response = self.request_code()
        self.assertEqual(response.status_code, 202)
        self.assertFalse(response.data["is_mock"])
        self.assertNotIn("development_code", response.data)
        post.assert_called_once()
