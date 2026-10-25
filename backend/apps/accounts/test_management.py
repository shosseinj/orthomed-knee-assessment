import json
from io import StringIO

from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Permission
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .permissions import can_manage_accounts


class AccountManagementTests(TestCase):
    def setUp(self):
        self.manager = User.objects.create_user("09500001001", is_staff=True, first_name="مدیر")
        self.permission = Permission.objects.get(content_type__app_label="accounts", codename="manage_account_verifications")
        self.manager.user_permissions.add(self.permission)
        self.doctor = User.objects.create_user("09500001002", role="doctor", first_name="حسین", last_name="محمدی", medical_council_number="123456", national_code="0013520822")
        self.insurance = User.objects.create_user("09500001003", role="insurance", organization_name="بیمه نمونه", is_verified=True)
        self.patient = User.objects.create_user("09500001004", role="patient", is_verified=True)
        self.staff = User.objects.create_user("09500001005", is_staff=True)
        self.client = APIClient()
        self.list_url = "/api/v1/auth/management/accounts/"

    def review_url(self, user):
        return f"{self.list_url}{user.pk}/"

    def test_only_account_manager_or_superuser_can_list_or_review(self):
        self.assertEqual(self.client.get(self.list_url).status_code, 401)
        for user in (self.doctor, self.insurance, self.patient, self.staff):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(self.list_url).status_code, 403)
            self.assertEqual(self.client.patch(self.review_url(self.doctor), {"is_verified": True}, format="json").status_code, 403)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.get(self.list_url).status_code, 200)
        superuser = User.objects.create_superuser("09500001006", "test-password")
        self.client.force_authenticate(superuser)
        self.assertEqual(self.client.get(self.list_url).status_code, 200)

    def test_self_serializer_has_capability_without_exposing_permission_flags_on_other_accounts(self):
        self.client.force_authenticate(self.manager)
        self.assertTrue(self.client.get("/api/v1/auth/me/").data["can_manage_accounts"])
        data = self.client.get(self.list_url).data
        self.assertEqual(data["count"], 2)
        for row in data["results"]:
            for secret in ("password", "user_permissions", "groups", "is_staff", "is_superuser", "encrypted_api_key", "can_manage_accounts"):
                self.assertNotIn(secret, row)
        self.client.force_authenticate(self.doctor)
        self.assertFalse(self.client.get("/api/v1/auth/me/").data["can_manage_accounts"])

    def test_search_filters_and_summary(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(self.list_url, {"status": "pending", "role": "doctor"})
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], str(self.doctor.pk))
        self.assertEqual(response.data["summary"], {"total": 2, "pending": 1, "verified": 1, "inactive": 0})
        for query in ("حسین محمدی", "۱۲۳۴۵۶", "09500001002", "0013520822"):
            with self.subTest(query=query):
                data = self.client.get(self.list_url, {"q": query}).data
                self.assertEqual(data["count"], 1)
                self.assertEqual(data["results"][0]["id"], str(self.doctor.pk))
        self.assertEqual(self.client.get(self.list_url, {"status": "verified"}).data["results"][0]["id"], str(self.insurance.pk))
        self.assertEqual(self.client.get(self.list_url, {"role": "admin"}).status_code, 400)
        self.assertEqual(self.client.get(self.list_url, {"status": "unknown"}).status_code, 400)

    def test_approve_opens_doctor_access_without_relogin_and_revoke_stops_it(self):
        token = str(RefreshToken.for_user(self.doctor).access_token)
        doctor_client = APIClient()
        doctor_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(doctor_client.get("/api/v1/cases/").status_code, 403)
        self.client.force_authenticate(self.manager)
        approved = self.client.patch(self.review_url(self.doctor), {"is_verified": True}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertTrue(approved.data["is_verified"])
        self.assertEqual(doctor_client.get("/api/v1/cases/").status_code, 200)
        self.assertTrue(doctor_client.get("/api/v1/auth/me/").data["is_verified"])
        self.client.patch(self.review_url(self.doctor), {"is_verified": False}, format="json")
        self.assertEqual(doctor_client.get("/api/v1/cases/").status_code, 403)
        self.assertEqual(LogEntry.objects.filter(user=self.manager, object_id=str(self.doctor.pk)).count(), 2)
        self.assertEqual(json.loads(LogEntry.objects.order_by("action_time").last().change_message)["action"], "revoke_account_approval")

    def test_approval_reactivates_disabled_account(self):
        self.doctor.is_active = False
        self.doctor.save()
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.get(self.list_url, {"status": "inactive"}).data["count"], 1)
        result = self.client.patch(self.review_url(self.doctor), {"is_verified": True}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data["is_active"])

    def test_review_cannot_change_role_permissions_or_patient_records(self):
        self.client.force_authenticate(self.manager)
        for payload in ({"is_verified": True, "is_superuser": True}, {"is_verified": True, "role": "patient"}, {"is_verified": True, "is_staff": True}, {}):
            self.assertEqual(self.client.patch(self.review_url(self.doctor), payload, format="json").status_code, 400)
        self.assertEqual(self.client.patch(self.review_url(self.patient), {"is_verified": True}, format="json").status_code, 404)
        self.doctor.refresh_from_db()
        self.assertFalse(self.doctor.is_verified)
        self.assertFalse(self.doctor.is_staff)
        self.assertFalse(self.doctor.is_superuser)
        self.assertEqual(self.doctor.role, "doctor")

    def test_list_is_paginated(self):
        for n in range(25):
            User.objects.create_user(f"0950010{n:04d}", role="doctor")
        self.client.force_authenticate(self.manager)
        response = self.client.get(self.list_url)
        self.assertEqual(len(response.data["results"]), 20)
        self.assertIsNotNone(response.data["next"])
        self.assertEqual(self.client.get(self.list_url, {"page": 2}).data["count"], 27)

    def test_inactive_or_staff_without_management_permission_is_not_manager(self):
        self.assertFalse(can_manage_accounts(self.staff))
        self.manager.is_active = False
        self.assertFalse(can_manage_accounts(self.manager))

    def test_grant_command_only_grants_account_management_to_existing_active_user(self):
        call_command("grant_account_manager", self.patient.phone_number, stdout=StringIO())
        self.patient.refresh_from_db()
        self.assertTrue(can_manage_accounts(self.patient))
        self.assertFalse(self.patient.is_superuser)
        self.assertFalse(self.patient.has_perm("accounts.change_user"))
        with self.assertRaises(CommandError):
            call_command("grant_account_manager", "09509999999", stdout=StringIO())

    def test_registration_does_not_accept_admin_privileges(self):
        from .services import issue_otp
        from django.test import override_settings
        with override_settings(DEBUG=True, ENABLE_MOCK_OTP=True, OTP_BACKEND="console", MOCK_OTP_CODE="11111"):
            phone = "09509999998"
            issue_otp(phone)
            verification = APIClient().post("/api/v1/auth/otp/verify/", {"phone_number": phone, "code": "11111"}, format="json")
            response = APIClient().post("/api/v1/auth/register/", {"registration_token": verification.data["registration_token"], "first_name": "کاربر", "last_name": "آزمایشی", "national_code": "0084575948", "birth_date": "1990-01-01", "role": "patient", "is_staff": True, "is_superuser": True, "can_manage_accounts": True}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(phone_number=phone)
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertFalse(response.data["user"]["can_manage_accounts"])
