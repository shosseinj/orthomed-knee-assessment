from datetime import date
from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.contrib.auth.models import Permission
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.cases.models import Assessment, MedicalCase
from .models import RoleRegistration, User
from .services import issue_otp


@override_settings(DEBUG=True, OTP_BACKEND="console", ENABLE_MOCK_OTP=True, MOCK_OTP_CODE="11111")
class RoleSessionTests(TestCase):
    phone = "09123456789"
    identity = dict(first_name="Sara", last_name="Test", national_code="0013520822", birth_date="1990-01-01")

    def setUp(self):
        self.user = User.objects.create_user(self.phone, **self.identity, role="patient", is_verified=True)

    def verify(self, role):
        issue_otp(self.phone)
        return APIClient().post("/api/v1/auth/otp/verify/", dict(phone_number=self.phone, code="11111", entry_role=role), format="json")

    def register(self, token, role, **overrides):
        return APIClient().post("/api/v1/auth/register/", {
            **self.identity, "role": role, "registration_token": token,
            "medical_council_number": "123456", "organization_name": "Insurance Co", **overrides,
        }, format="json")

    def client_for(self, result):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {result.data['access']}")
        return client

    def test_same_identity_registers_each_role_and_signs_in_to_each_independently(self):
        original = self.verify("patient")
        patient_client = self.client_for(original)
        case = MedicalCase.objects.create(patient=self.user)
        clients = {}
        for role in ("doctor", "insurance"):
            with self.subTest(role=role):
                missing = self.verify(role)
                self.assertTrue(missing.data["registration_required"])
                self.assertNotIn("access", missing.data)
                self.assertEqual(missing.data["registration_profile"]["national_code"], self.identity["national_code"])
                registered = self.register(missing.data["registration_token"], role)
                self.assertEqual(registered.status_code, 201, registered.data)
                self.assertEqual(registered.data["user"]["id"], str(self.user.pk))
                self.assertEqual(registered.data["user"]["role"], role)
                self.assertFalse(registered.data["user"]["is_verified"])
                clients[role] = self.client_for(registered)
                self.assertEqual(clients[role].get("/api/v1/cases/").status_code, 403)
                again = self.verify(role)
                self.assertFalse(again.data["registration_required"])
                self.assertEqual(again.data["user"]["role"], role)
                self.assertEqual(self.register(missing.data["registration_token"], role).status_code, 400)
        self.assertEqual(User.objects.filter(phone_number=self.phone).count(), 1)
        self.assertEqual(set(self.user.role_registrations.values_list("role", flat=True)), {"patient", "doctor", "insurance"})
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, "patient")
        self.assertTrue(self.user.is_verified)
        self.assertEqual(patient_client.get("/api/v1/auth/me/").data["role"], "patient")
        self.assertEqual(patient_client.get(f"/api/v1/cases/{case.pk}/").status_code, 200)
        self.assertEqual(clients["doctor"].get("/api/v1/auth/me/").data["role"], "doctor")
        self.assertEqual(clients["insurance"].get("/api/v1/auth/me/").data["role"], "insurance")

    def test_doctor_and_insurance_can_also_add_patient_without_replacing_their_original_role(self):
        for primary in ("doctor", "insurance"):
            with self.subTest(primary=primary):
                # Use a different identity to exercise both directions of role registration.
                user = User.objects.create_user(f"0912000000{len(User.objects.all())}", role=primary, first_name="Alex", last_name="Test")
                issue_otp(user.phone_number)
                verified = APIClient().post("/api/v1/auth/otp/verify/", dict(phone_number=user.phone_number, code="11111", entry_role="patient"), format="json")
                registered = APIClient().post("/api/v1/auth/register/", {**self.identity, "first_name": "Alex", "registration_token": verified.data["registration_token"], "role": "patient", "national_code": "0084575948"}, format="json")
                self.assertEqual(registered.status_code, 201, registered.data)
                patient_client = self.client_for(registered)
                self.assertEqual(patient_client.post("/api/v1/cases/", {}, format="json").status_code, 201)
                user.refresh_from_db()
                self.assertEqual(user.role, primary)
                self.assertFalse(user.is_verified)
                self.assertEqual(user.birth_date, date(1990, 1, 1))
                MedicalCase.objects.filter(patient=user).delete()
                user.delete()

    def test_approval_revocation_and_reactivation_are_scoped_to_each_role(self):
        tokens = {}
        for role in ("doctor", "insurance"):
            token = self.verify(role).data["registration_token"]
            tokens[role] = self.client_for(self.register(token, role))
        admin = User.objects.create_superuser("09120000001", "test-password")
        admin_client = APIClient()
        admin_client.force_authenticate(admin)
        registrations = {row.role: row for row in self.user.role_registrations.all()}
        listed = admin_client.get("/api/v1/auth/management/accounts/")
        self.assertEqual(listed.status_code, 200)
        self.assertTrue({str(registrations[r].pk) for r in ("doctor", "insurance")} <= {row["id"] for row in listed.data["results"]})
        for role in ("doctor", "insurance"):
            reviewed = admin_client.patch(f"/api/v1/auth/management/accounts/{registrations[role].pk}/", {"is_verified": True}, format="json")
            self.assertEqual(reviewed.status_code, 200, reviewed.data)
            self.assertTrue(tokens[role].get("/api/v1/auth/me/").data["is_verified"])
            self.assertEqual(tokens[role].get("/api/v1/cases/").status_code, 200)
        admin_client.patch(f"/api/v1/auth/management/accounts/{registrations['doctor'].pk}/", {"is_verified": False}, format="json")
        self.assertEqual(tokens["doctor"].get("/api/v1/cases/").status_code, 403)
        self.assertEqual(tokens["insurance"].get("/api/v1/cases/").status_code, 200)
        self.assertEqual(self.client_for(self.verify("patient")).get("/api/v1/cases/").status_code, 200)

    def test_admin_permissions_do_not_leak_into_patient_session(self):
        self.user.is_staff = True
        self.user.save(update_fields=["is_staff"])
        self.user.user_permissions.add(Permission.objects.get(codename="manage_account_verifications"))
        patient = self.verify("patient")
        admin = self.verify("admin")
        self.assertFalse(patient.data["user"]["can_manage_accounts"])
        self.assertEqual(patient.data["user"]["role"], "patient")
        self.assertTrue(admin.data["user"]["can_manage_accounts"])
        self.assertEqual(admin.data["user"]["role"], "admin")
        patient_client, admin_client = self.client_for(patient), self.client_for(admin)
        self.assertEqual(patient_client.get("/api/v1/auth/management/accounts/").status_code, 403)
        self.assertEqual(admin_client.get("/api/v1/auth/management/accounts/").status_code, 200)
        self.assertEqual(admin_client.get("/api/v1/cases/").status_code, 403)
        self.assertEqual(admin_client.post("/api/v1/cases/", {}, format="json").status_code, 403)
        self.user.user_permissions.clear()
        self.assertEqual(admin_client.get("/api/v1/auth/me/").status_code, 401)

    def test_refresh_keeps_selected_role_and_client_cannot_change_role(self):
        RoleRegistration.objects.create(user=self.user, role="doctor", is_verified=True, medical_council_number="123456")
        doctor = self.verify("doctor")
        refreshed = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": doctor.data["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(AccessToken(refreshed.data["access"])["active_role"], "doctor")
        patient = self.client_for(self.verify("patient"))
        self.assertEqual(patient.post("/api/v1/cases/my-patients/", {"active_role": "doctor", "phone_number": self.phone}, format="json").status_code, 403)
        self.assertEqual(patient.get("/api/v1/auth/me/?role=doctor").data["role"], "patient")
        self.assertEqual(self.client_for(doctor).patch("/api/v1/auth/me/", {"first_name": "Changed"}, format="json").status_code, 403)

    def test_role_disable_invalidates_existing_token_and_prevents_login(self):
        RoleRegistration.objects.create(user=self.user, role="doctor", is_verified=True)
        doctor = self.client_for(self.verify("doctor"))
        self.user.role_registrations.filter(role="doctor").update(is_active=False)
        self.assertEqual(doctor.get("/api/v1/auth/me/").status_code, 401)
        self.assertEqual(self.verify("doctor").status_code, 400)
        self.assertEqual(self.verify("patient").status_code, 200)

    def test_new_role_cannot_change_identity_or_create_duplicate_registration(self):
        token = self.verify("doctor").data["registration_token"]
        self.assertEqual(self.register(token, "doctor", national_code="0084575948").status_code, 400)
        self.assertEqual(self.register(token, "doctor", first_name="Someone else").status_code, 400)
        self.assertEqual(self.register(token, "patient").status_code, 400)
        self.assertEqual(self.register(token, "doctor").status_code, 201)
        with self.assertRaises(IntegrityError), transaction.atomic():
            RoleRegistration.objects.create(user=self.user, role="doctor")

    def test_disabling_primary_role_does_not_disable_other_roles_or_reset_on_identity_save(self):
        RoleRegistration.objects.create(user=self.user, role="doctor", is_verified=True)
        self.user.role_registrations.filter(role="patient").update(is_active=False)
        self.user.first_name = "Updated"
        self.user.save(update_fields=["first_name"])
        self.assertEqual(self.verify("patient").status_code, 400)
        self.assertEqual(self.verify("doctor").status_code, 200)

    def test_patient_doctor_and_insurance_sessions_keep_distinct_clinical_permissions(self):
        for role in ("doctor", "insurance"):
            RoleRegistration.objects.create(user=self.user, role=role, is_verified=True)
        patient = self.client_for(self.verify("patient"))
        doctor = self.client_for(self.verify("doctor"))
        insurer = self.client_for(self.verify("insurance"))
        case = MedicalCase.objects.create(patient=self.user, status="under_review")
        Assessment.objects.create(case=case, source="doctor", author=self.user,
                                  verdict="inconclusive", rationale="Private assessment")
        url = f"/api/v1/cases/{case.pk}/"
        self.assertEqual(patient.get(url).data["assessments"], [])
        self.assertEqual(len(doctor.get(url).data["assessments"]), 1)
        self.assertEqual(len(insurer.get(url).data["assessments"]), 1)
        for client in (patient, insurer):
            self.assertEqual(client.put(url + "doctor-assessment/", {}, format="json").status_code, 403)
        for client in (patient, doctor):
            self.assertEqual(client.put(url + "insurance-decision/", {}, format="json").status_code, 403)
        self.assertEqual(insurer.post("/api/v1/cases/", {}, format="json").status_code, 403)

    def test_doctor_can_find_a_patient_registered_under_another_primary_role(self):
        self.user.role_registrations.create(role="doctor", is_verified=True)
        other = User.objects.create_user("09121112233", role="insurance", first_name="Alex")
        other.role_registrations.create(role="patient", is_verified=True)
        doctor = self.client_for(self.verify("doctor"))
        response = doctor.post("/api/v1/cases/my-patients/", {"phone_number": other.phone_number}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["patient"]["role"], "patient")
        self.assertEqual(response.data["patient"]["id"], str(other.pk))

    def test_backfill_preserves_primary_role_and_approval(self):
        # Run the data migration against an existing identity without its backfill.
        self.user.role_registrations.all().delete()
        migration = import_module("apps.accounts.migrations.0006_role_registrations")
        from django.db import connection
        migration.preserve_existing_roles(apps, SimpleNamespace(connection=connection))
        registration = self.user.role_registrations.get()
        self.assertEqual(registration.pk, self.user.pk)
        self.assertEqual(registration.role, "patient")
        self.assertTrue(registration.is_verified)
        self.assertEqual(registration.date_joined, self.user.date_joined)
