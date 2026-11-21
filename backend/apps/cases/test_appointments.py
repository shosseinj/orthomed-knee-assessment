import base64
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import tempfile
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.serializers import login_result
from .appointments import bind_pending_appointments, check_in
from .models import Appointment, Assessment, DoctorPatient, DoctorQR, MedicalCase, QuestionnaireResponse, XRayImage


class AppointmentFixture(TestCase):
    def setUp(self):
        self.doctor = User.objects.create_user("09123330001", role="doctor", is_verified=True, first_name="Sara", medical_council_number="123")
        self.other_doctor = User.objects.create_user("09123330002", role="doctor", is_verified=True)
        self.patient = User.objects.create_user("09123330003", role="patient", is_verified=True)
        self.other_patient = User.objects.create_user("09123330004", role="patient", is_verified=True)
        self.client = APIClient()
        self.client.force_authenticate(self.doctor)
        self.future = (timezone.now() + timedelta(days=1)).replace(second=0, microsecond=0)

    def book(self, phone=None, when=None):
        return self.client.post("/api/v1/appointments/", {"phone_number": phone or self.patient.phone_number, "scheduled_at": (when or self.future).isoformat()}, format="json")



class AppointmentTests(AppointmentFixture):
    def test_registered_booking_creates_exactly_one_owned_case_and_is_listed_for_patient(self):
        response = self.book()
        self.assertEqual(response.status_code, 201, response.data)
        appointment = Appointment.objects.get(pk=response.data["id"])
        self.assertEqual(appointment.patient, self.patient)
        self.assertEqual(appointment.case.managing_doctor, self.doctor)
        self.assertEqual(appointment.case.status, "draft")
        self.client.force_authenticate(self.patient)
        self.assertEqual(self.client.get("/api/v1/appointments/").data["results"][0]["case_id"], str(appointment.case_id))
        detail = self.client.get(f"/api/v1/cases/{appointment.case_id}/")
        self.assertTrue(detail.data["can_edit_intake"])
        self.assertFalse(detail.data["can_delete_draft"])
        self.assertEqual(self.client.delete(f"/api/v1/cases/{appointment.case_id}/").status_code, 400)
        self.client.force_authenticate(self.other_patient)
        self.assertEqual(self.client.get("/api/v1/appointments/").data["count"], 0)
        self.assertEqual(self.client.get(f"/api/v1/cases/{appointment.case_id}/").status_code, 404)

    @override_settings(DEBUG=True, OTP_BACKEND="console", ENABLE_MOCK_OTP=True, MOCK_OTP_CODE="11111")
    def test_registration_after_phone_verification_attaches_pending_appointment(self):
        response = self.book("09123330009")
        self.client.force_authenticate(None)
        self.client.post("/api/v1/auth/otp/request/", {"phone_number": "09123330009"}, format="json")
        verified = self.client.post("/api/v1/auth/otp/verify/", {"phone_number": "09123330009", "code": "11111", "entry_role": "patient"}, format="json")
        self.assertTrue(verified.data["registration_required"])
        registered = self.client.post("/api/v1/auth/register/", {
            "registration_token": verified.data["registration_token"], "role": "patient",
            "first_name": "New", "last_name": "Patient", "national_code": "0013520822", "birth_date": "1990-01-01",
        }, format="json")
        self.assertEqual(registered.status_code, 201, registered.data)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + registered.data["access"])
        appointments = self.client.get("/api/v1/appointments/").data["results"]
        self.assertEqual(appointments[0]["id"], response.data["id"])
        self.assertIsNotNone(appointments[0]["case_id"])


    def test_pending_booking_binds_only_after_patient_login_and_is_repeat_safe(self):
        response = self.book("09123330009")
        appointment = Appointment.objects.get(pk=response.data["id"])
        self.assertIsNone(appointment.patient_id)
        self.assertIsNone(appointment.case_id)
        new_patient = User.objects.create_user(appointment.phone_number, role="patient", is_verified=True)
        login_result(new_patient, "patient")
        appointment.refresh_from_db()
        self.assertEqual(appointment.patient, new_patient)
        original = appointment.case_id
        login_result(new_patient, "patient")
        appointment.refresh_from_db()
        self.assertEqual(appointment.case_id, original)
        self.assertEqual(MedicalCase.objects.filter(patient=new_patient).count(), 1)

    def test_other_role_and_other_phone_cannot_claim_pending_booking(self):
        response = self.book("09123330009")
        user = User.objects.create_user("09123330009", role="doctor")
        login_result(user, "doctor")
        bind_pending_appointments(self.other_patient)
        appointment = Appointment.objects.get(pk=response.data["id"])
        self.assertIsNone(appointment.patient_id)

    def test_cancelled_pending_booking_is_not_claimed(self):
        response = self.book("09123330009")
        self.client.patch(f'/api/v1/appointments/{response.data["id"]}/', {"status": "cancelled"}, format="json")
        patient = User.objects.create_user("09123330009", role="patient")
        login_result(patient, "patient")
        self.assertIsNone(Appointment.objects.get(pk=response.data["id"]).case_id)

    def test_booking_validates_phone_future_time_and_exact_conflicts(self):
        for phone, when in (("bad", self.future), (self.patient.phone_number, timezone.now() - timedelta(minutes=1))):
            self.assertEqual(self.book(phone, when).status_code, 400)
        self.assertEqual(self.book().status_code, 201)
        self.assertEqual(self.book(self.other_patient.phone_number).status_code, 400)
        self.assertEqual(MedicalCase.objects.count(), 1)
        self.client.force_authenticate(self.other_doctor)
        self.assertEqual(self.book().status_code, 201)

    def test_reschedule_cancel_and_reuse_slot(self):
        response = self.book()
        url = f'/api/v1/appointments/{response.data["id"]}/'
        changed = self.client.patch(url, {"scheduled_at": (self.future + timedelta(hours=1)).isoformat()}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(self.client.patch(url, {"status": "cancelled"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(url, {"scheduled_at": self.future.isoformat()}, format="json").status_code, 400)
        appointment = Appointment.objects.get(pk=response.data["id"])
        self.client.force_authenticate(self.patient)
        detail = self.client.get(f"/api/v1/cases/{appointment.case_id}/")
        self.assertFalse(detail.data["can_edit_intake"])
        self.assertEqual(self.client.put(f"/api/v1/cases/{appointment.case_id}/questionnaire/", {}, format="json").status_code, 403)
        self.client.force_authenticate(self.doctor)
        self.assertEqual(self.book(when=self.future + timedelta(hours=1)).status_code, 201)

    def test_admission_and_completion_lock_scheduling_and_intake(self):
        response = self.book()
        url = f'/api/v1/appointments/{response.data["id"]}/'
        self.assertEqual(self.client.patch(url, {"status": "checked_in"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(url, {"status": "cancelled"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"scheduled_at": self.future.isoformat()}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"status": "completed"}, format="json").status_code, 200)
        self.assertFalse(self.client.get(f'/api/v1/cases/{response.data["case_id"]}/').data["can_edit_intake"])

    def test_patient_other_doctor_insurance_and_unverified_access(self):
        response = self.book()
        url = f'/api/v1/appointments/{response.data["id"]}/'
        for user in (self.patient, self.other_doctor):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.patch(url, {"status": "cancelled"}, format="json").status_code, 403 if user == self.patient else 404)
        self.client.force_authenticate(self.patient)
        self.assertEqual(self.book().status_code, 403)
        self.doctor.is_verified = False
        self.doctor.save()
        self.client.force_authenticate(self.doctor)
        self.assertEqual(self.client.get("/api/v1/appointments/").status_code, 403)

    def test_insurance_and_anonymous_sessions_cannot_manage_appointments(self):
        insurer = User.objects.create_user("09123330011", role="insurance", is_verified=True)
        self.client.force_authenticate(insurer)
        self.assertEqual(self.client.get("/api/v1/appointments/").status_code, 403)
        self.assertEqual(self.book().status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/v1/appointments/").status_code, 401)

    def test_direct_case_creation_is_closed_even_for_assigned_patient(self):
        DoctorPatient.objects.create(doctor=self.doctor, patient=self.patient)
        for user in (self.patient, self.doctor):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post("/api/v1/cases/", {"patient_id": str(self.patient.pk)}, format="json").status_code, 403)


@override_settings(FRONTEND_PUBLIC_URL="https://orthomed.example")
class QRTests(AppointmentFixture):
    def reception(self):
        qr = DoctorQR.objects.get(doctor=self.doctor)
        return f"/api/v1/reception/{qr.token}/"

    def test_qr_is_automatically_created_and_png_encodes_canonical_origin(self):
        response = self.client.get("/api/v1/doctor-qr/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["url"].startswith("https://orthomed.example/check-in/"))
        raw = base64.b64decode(response.data["image"].split(",")[1])
        self.assertEqual(Image.open(io.BytesIO(raw)).format, "PNG")
        with patch("qrcode.make", wraps=__import__("qrcode").make) as make:
            self.client.get("/api/v1/doctor-qr/")
            make.assert_called_once_with(response.data["url"])

    def test_public_page_only_reveals_doctor_name_and_council_number_and_does_not_create(self):
        self.client.force_authenticate(None)
        response = self.client.get(self.reception())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data["doctor"]), {"full_name", "medical_council_number"})
        self.assertEqual(Appointment.objects.count(), 0)
        self.assertEqual(self.client.post(self.reception(), {}, format="json").status_code, 403)

    def test_patient_checkin_repeat_after_submission_and_completion_keeps_answers(self):
        self.client.force_authenticate(self.patient)
        url = self.reception()
        first = self.client.post(url, {}, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        appointment = Appointment.objects.get(pk=first.data["id"])
        QuestionnaireResponse.objects.create(case=appointment.case, additional_notes="preserve me", pain_level=0, pain_duration_months=1, mobility_limit="none")
        appointment.case.status = "submitted"
        appointment.case.save()
        appointment.status = "completed"
        appointment.save()
        second = self.client.post(url, {}, format="json")
        self.assertEqual(second.data["id"], first.data["id"])
        self.assertEqual(Appointment.objects.count(), 1)
        self.assertEqual(appointment.case.questionnaire.additional_notes, "preserve me")

    def test_same_day_booking_is_admitted_and_tomorrow_booking_is_not_consumed(self):
        now = timezone.now()
        today = Appointment.objects.create(doctor=self.doctor, phone_number=self.patient.phone_number, scheduled_at=now)
        tomorrow = Appointment.objects.create(doctor=self.doctor, phone_number=self.patient.phone_number, scheduled_at=now + timedelta(days=1))
        self.client.force_authenticate(self.patient)
        response = self.client.post(self.reception(), {}, format="json")
        self.assertEqual(response.data["id"], str(today.pk))
        tomorrow.refresh_from_db()
        self.assertEqual(tomorrow.status, "scheduled")

    def test_two_doctors_get_separate_cases_and_cancelled_visit_is_not_reused(self):
        self.client.force_authenticate(self.patient)
        first = self.client.post(self.reception(), {}, format="json")
        appointment = Appointment.objects.get(pk=first.data["id"])
        appointment.status = "cancelled"
        appointment.save()
        second = self.client.post(self.reception(), {}, format="json")
        self.assertNotEqual(first.data["id"], second.data["id"])
        qr = DoctorQR.objects.get(doctor=self.other_doctor)
        third = self.client.post(f"/api/v1/reception/{qr.token}/", {}, format="json")
        self.assertNotEqual(second.data["case_id"], third.data["case_id"])

    def test_disable_rotate_and_revoke_doctor_block_reception(self):
        url = self.reception()
        self.assertEqual(self.client.patch("/api/v1/doctor-qr/", {"is_active": False}, format="json").status_code, 200)
        self.client.force_authenticate(self.patient)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 404)
        self.client.force_authenticate(self.doctor)
        replacement = self.client.post("/api/v1/doctor-qr/", {}, format="json")
        self.assertEqual(replacement.status_code, 200)
        self.assertNotEqual(replacement.data["token"], url.split("/")[-2])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.doctor.is_verified = False
        self.doctor.save()
        self.client.force_authenticate(self.patient)
        self.assertEqual(self.client.get(self.reception()).status_code, 404)
        self.assertEqual(self.client.post(self.reception(), {}, format="json").status_code, 404)

    def test_wrong_role_cannot_admit_or_manage_another_doctor_qr(self):
        self.assertEqual(self.client.post(self.reception(), {}, format="json").status_code, 403)
        self.client.force_authenticate(self.patient)
        for method in (self.client.get, self.client.post):
            self.assertEqual(method("/api/v1/doctor-qr/").status_code, 403)

    def test_multirole_public_identity_uses_doctor_name_and_registration(self):
        identity = User.objects.create_user("09123330010", role="insurance", is_verified=True,
                                            first_name="Ali", last_name="Test", organization_name="Private company")
        registration = identity.role_registrations.create(role="doctor", is_verified=True, medical_council_number="567")
        qr = DoctorQR.objects.get(doctor=identity)
        self.client.force_authenticate(None)
        response = self.client.get(f"/api/v1/reception/{qr.token}/")
        self.assertEqual(response.data["doctor"], {"full_name": "Ali Test", "medical_council_number": "567"})
        registration.is_active = False
        registration.save()
        self.assertEqual(self.client.get(f"/api/v1/reception/{qr.token}/").status_code, 404)


    def test_tehran_day_boundary_does_not_reuse_yesterdays_visit(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        now = datetime(2026, 11, 22, 0, 1, tzinfo=ZoneInfo("Asia/Tehran"))
        Appointment.objects.create(doctor=self.doctor, phone_number=self.patient.phone_number, scheduled_at=now - timedelta(minutes=2), status="checked_in", source="qr", checked_in_at=now - timedelta(minutes=2))
        with patch("apps.cases.appointments.timezone.now", return_value=now):
            result = check_in(DoctorQR.objects.get(doctor=self.doctor).token, self.patient)
        self.assertEqual(result.scheduled_at, now)
        self.assertEqual(Appointment.objects.count(), 2)


class HistoryAccessTests(AppointmentFixture):
    def setUp(self):
        super().setUp()
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)
        self.old_case = MedicalCase.objects.create(patient=self.patient, managing_doctor=self.other_doctor, status="submitted")
        self.old_image = XRayImage.objects.create(case=self.old_case, image=SimpleUploadedFile("knee.png", b"private image"))
        self.draft = MedicalCase.objects.create(patient=self.patient, managing_doctor=self.other_doctor)

    def test_unrelated_doctor_cannot_read_list_detail_or_direct_file(self):
        self.assertEqual(self.client.get("/api/v1/cases/").data["count"], 0)
        self.assertEqual(self.client.get(f"/api/v1/cases/{self.old_case.pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/images/{self.old_image.pk}/file/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/v1/cases/patient-history/?patient_id={self.patient.pk}").status_code, 403)

    @override_settings(DEBUG=True)
    def test_raw_media_urls_cannot_bypass_file_permissions_in_development(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.old_image.image.url).status_code, 404)

    def test_adding_phone_alone_does_not_grant_history(self):
        self.client.post("/api/v1/cases/my-patients/", {"phone_number": self.patient.phone_number}, format="json")
        self.assertEqual(self.client.get(f"/api/v1/cases/{self.old_case.pk}/").status_code, 404)

    def test_booking_grants_readonly_history_not_other_drafts_and_list_remains_owned(self):
        booked = self.book()
        detail = self.client.get(f"/api/v1/cases/{self.old_case.pk}/")
        self.assertEqual(detail.status_code, 200, detail.data)
        for flag in ("can_edit_intake", "can_review", "can_request_ai", "can_delete_draft"):
            self.assertFalse(detail.data[flag])
        self.assertEqual(self.client.get(f"/api/v1/cases/{self.draft.pk}/").status_code, 404)
        own = self.client.get("/api/v1/cases/").data["results"]
        self.assertEqual([row["id"] for row in own], [booked.data["case_id"]])
        history = self.client.get(f"/api/v1/cases/patient-history/?patient_id={self.patient.pk}")
        self.assertEqual(history.status_code, 200, history.data)
        self.assertEqual([item["id"] for item in history.data["results"]], [str(self.old_case.pk)])
        file = self.client.get(f"/api/v1/images/{self.old_image.pk}/file/")
        self.assertEqual(file.status_code, 200)
        file.close()
        for action in ("questionnaire", "womac", "doctor-assessment"):
            self.assertEqual(self.client.put(f"/api/v1/cases/{self.old_case.pk}/{action}/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/v1/cases/{self.old_case.pk}/", {"title": "forbidden"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/v1/cases/{self.old_case.pk}/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/v1/cases/{self.old_case.pk}/ai-assessment/", {}, format="json").status_code, 403)
        for action in ("classify", "confirm"):
            self.assertEqual(self.client.post(f"/api/v1/images/{self.old_image.pk}/{action}/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/v1/images/{self.old_image.pk}/").status_code, 403)

    def test_cancelled_only_booking_revokes_history_but_legacy_owned_submitted_case_preserves_it(self):
        booked = self.book()
        self.client.patch(f'/api/v1/appointments/{booked.data["id"]}/', {"status": "cancelled"}, format="json")
        self.assertEqual(self.client.get(f"/api/v1/cases/{self.old_case.pk}/").status_code, 404)
        MedicalCase.objects.create(patient=self.patient, managing_doctor=self.doctor, status="submitted")
        self.assertEqual(self.client.get(f"/api/v1/cases/{self.old_case.pk}/").status_code, 200)


class ConcurrentReceptionTests(TransactionTestCase):
    def test_two_simultaneous_scans_return_one_appointment_and_case(self):
        from threading import Barrier
        doctor = User.objects.create_user("09123339991", role="doctor", is_verified=True)
        patient = User.objects.create_user("09123339992", role="patient", is_verified=True)
        token = DoctorQR.objects.get(doctor=doctor).token
        barrier = Barrier(2)

        def scan():
            close_old_connections()
            try:
                user = User.objects.get(pk=patient.pk)
                barrier.wait(timeout=5)
                return check_in(token, user).pk
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: scan(), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(Appointment.objects.count(), 1)
        self.assertEqual(MedicalCase.objects.count(), 1)


class ExistingDataMigrationTests(AppointmentFixture):
    def test_existing_links_and_unassigned_cases_are_preserved(self):
        import importlib
        from types import SimpleNamespace
        from django.apps import apps
        from django.db import connection
        assigned = MedicalCase.objects.create(patient=self.patient, managing_doctor=self.doctor, status="submitted")
        unassigned = MedicalCase.objects.create(patient=self.patient, status="submitted")
        migration = importlib.import_module("apps.cases.migrations.0011_existing_doctor_links")
        migration.preserve_links(apps, SimpleNamespace(connection=connection))
        migration.preserve_links(apps, SimpleNamespace(connection=connection))
        assigned.refresh_from_db()
        unassigned.refresh_from_db()
        self.assertEqual(assigned.managing_doctor, self.doctor)
        self.assertIsNone(unassigned.managing_doctor)
        self.assertEqual(DoctorPatient.objects.filter(doctor=self.doctor, patient=self.patient).count(), 1)
