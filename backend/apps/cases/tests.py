import json
from unittest.mock import Mock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from .catalogs import persian_sort_key
from .models import Assessment, DoctorPatient, InsuranceDecision, MedicalCase, QuestionnaireResponse, WOMACResponse, XRayImage
from .questionnaires import KNEE_SUPPLEMENTAL_ITEMS, WOMAC_ITEMS
from .serializers import WOMACSerializer
from .services import request_ai_assessment


class CasePermissionTests(TestCase):
    def setUp(self):
        self.patient = User.objects.create_user("09120000001", role=User.Role.PATIENT, is_verified=True, national_code="0013520822", birth_date="1990-01-01")
        self.other_patient = User.objects.create_user("09120000002", role=User.Role.PATIENT, is_verified=True)
        self.doctor = User.objects.create_user("09120000003", role=User.Role.DOCTOR, is_verified=True)
        self.insurance = User.objects.create_user("09120000004", role=User.Role.INSURANCE, is_verified=True)
        self.case = MedicalCase.objects.create(patient=self.patient)
        self.client = APIClient()

    def test_patient_only_lists_own_cases(self):
        MedicalCase.objects.create(patient=self.other_patient)
        self.client.force_authenticate(self.patient)
        response = self.client.get("/api/v1/cases/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)

    def test_doctor_and_insurance_can_see_patient_identity_in_case(self):
        self.case.status = MedicalCase.Status.UNDER_REVIEW
        self.case.save(update_fields=["status"])
        for reviewer in (self.doctor, self.insurance):
            self.client.force_authenticate(reviewer)
            response = self.client.get(f"/api/v1/cases/{self.case.id}/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["patient"]["national_code"], "0013520822")
            self.assertEqual(response.data["patient"]["birth_date"], "1990-01-01")
            self.assertNotIn("national_code", response.data["managing_doctor"] or {})

    def test_anonymous_case_list_is_rejected(self):
        response = self.client.get("/api/v1/cases/")
        self.assertEqual(response.status_code, 401)

    def test_authenticated_user_can_search_medical_catalogs(self):
        self.client.force_authenticate(self.patient)

        diseases = self.client.get("/api/v1/catalogs/diseases/?q=فشارخون")
        self.assertEqual(diseases.status_code, 200)
        self.assertTrue(any(item["label"] == "فشارخون بالا" for item in diseases.data["results"]))

        medications = self.client.get("/api/v1/catalogs/medications/?q=ایبوپروفن")
        self.assertEqual(medications.status_code, 200)
        self.assertTrue(medications.data["results"])
        self.assertTrue(all(item["secondary"] for item in medications.data["results"]))

        asa = self.client.get("/api/v1/catalogs/medications/?q=آ%20اس%20آ&limit=50")
        self.assertTrue(any("Amin Pharmaceutical Co." in item["secondary"] for item in asa.data["results"]))

    def test_catalogs_are_persian_sorted_and_paginated(self):
        self.client.force_authenticate(self.patient)

        first_page = self.client.get("/api/v1/catalogs/diseases/?limit=5&offset=0")
        second_page = self.client.get("/api/v1/catalogs/diseases/?limit=5&offset=5")

        self.assertEqual(first_page.status_code, 200)
        self.assertGreater(first_page.data["count"], 30)
        self.assertEqual(first_page.data["next_offset"], 5)
        labels = [item["label"] for item in first_page.data["results"] + second_page.data["results"]]
        self.assertEqual(labels, sorted(labels, key=persian_sort_key))
        self.assertNotEqual(first_page.data["results"], second_page.data["results"])

    def test_english_catalog_labels_preserve_saved_values_and_support_both_search_languages(self):
        self.client.force_authenticate(self.patient)
        persian = self.client.get("/api/v1/catalogs/diseases/?q=فشارخون").data["results"]
        english = self.client.get("/api/v1/catalogs/diseases/?q=High%20blood%20pressure", HTTP_ACCEPT_LANGUAGE="en-US").data["results"]
        self.assertEqual(english[0]["label"], "High blood pressure")
        self.assertEqual(english[0]["value"], persian[0]["value"])
        self.assertEqual(english[0]["value"], "فشارخون بالا")
        medications_fa = self.client.get("/api/v1/catalogs/medications/?q=آ%20اس%20آ&limit=50").data["results"]
        medications_en = self.client.get("/api/v1/catalogs/medications/?q=آ%20اس%20آ&limit=50", HTTP_ACCEPT_LANGUAGE="en").data["results"]
        self.assertTrue(any(row["label"] == "ASA" for row in medications_en))
        self.assertEqual({row["value"] for row in medications_en}, {row["value"] for row in medications_fa})

    def test_english_catalog_pagination_is_alphabetical(self):
        self.client.force_authenticate(self.patient)
        pages = [self.client.get(f"/api/v1/catalogs/diseases/?limit=5&offset={offset}", HTTP_ACCEPT_LANGUAGE="en").data for offset in (0, 5)]
        labels = [row["label"] for page in pages for row in page["results"]]
        self.assertEqual(labels, sorted(labels, key=str.casefold))
        self.assertEqual(pages[0]["next_offset"], 5)

    def test_anonymous_user_cannot_search_medical_catalogs(self):
        response = self.client.get("/api/v1/catalogs/diseases/?q=دیابت")
        self.assertEqual(response.status_code, 401)

    def test_insurance_cannot_see_drafts(self):
        self.client.force_authenticate(self.insurance)
        response = self.client.get("/api/v1/cases/")
        self.assertEqual(response.data["count"], 0)

    def test_verified_doctor_can_assess_submitted_case(self):
        self.case.status = MedicalCase.Status.SUBMITTED
        self.case.save()
        self.client.force_authenticate(self.doctor)
        response = self.client.put(f"/api/v1/cases/{self.case.id}/doctor-assessment/", {
            "verdict": "no_surgery", "rationale": "درمان محافظه‌کارانه توصیه می‌شود.", "clinical_history": "درد متوسط"
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.case.refresh_from_db()
        self.assertEqual(self.case.status, MedicalCase.Status.UNDER_REVIEW)

    def test_doctor_can_add_registered_patient_and_start_their_case(self):
        self.client.force_authenticate(self.doctor)
        added = self.client.post("/api/v1/cases/my-patients/", {
            "phone_number": self.other_patient.phone_number,
        }, format="json")
        self.assertEqual(added.status_code, 201, added.data)
        self.assertEqual(added.data["patient"]["id"], str(self.other_patient.id))
        self.assertTrue(DoctorPatient.objects.filter(doctor=self.doctor, patient=self.other_patient).exists())

        created = self.client.post("/api/v1/cases/", {
            "patient_id": str(self.other_patient.id),
        }, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        doctor_case = MedicalCase.objects.get(pk=created.data["id"])
        self.assertEqual(doctor_case.patient, self.other_patient)
        self.assertEqual(doctor_case.managing_doctor, self.doctor)
        self.assertTrue(created.data["can_edit_intake"])

        questionnaire = self.client.put(f"/api/v1/cases/{doctor_case.id}/questionnaire/", {
            "age_years": 65,
            "gender": "female",
            "underlying_conditions": ["فشارخون بالا", "دیابت نوع ۲", "بیماری ثبت‌نشده در فهرست"],
            "medications": ["ایبوپروفن — IBUPROFEN"],
            "height_cm": "165",
            "weight_kg": "70",
            "pain_level": 7,
            "pain_duration_months": 12,
            "mobility_limit": "moderate",
            "previous_treatments": [],
            "conservative_treatment_rounds": 0,
            "conservative_duration_months": 0,
            "conservative_response": "not_tried",
            "had_intra_articular_injection": False,
            "injection_rounds": 0,
            "injection_types": [],
            "daily_life_impact": "moderate",
            "smoking_status": "never",
            "diabetes_status": "none",
            "has_night_pain": False,
            "uses_walking_aid": False,
        }, format="json")
        self.assertEqual(questionnaire.status_code, 200, questionnaire.data)
        self.assertEqual(questionnaire.data["underlying_conditions"], ["فشارخون بالا", "دیابت نوع ۲", "بیماری ثبت‌نشده در فهرست"])
        self.assertEqual(questionnaire.data["medications"], ["ایبوپروفن — IBUPROFEN"])

    def test_doctor_cannot_start_case_before_adding_patient(self):
        self.client.force_authenticate(self.doctor)
        response = self.client.post("/api/v1/cases/", {
            "patient_id": str(self.other_patient.id),
        }, format="json")
        self.assertEqual(response.status_code, 400)

    def test_other_doctor_cannot_open_managed_draft(self):
        doctor_case = MedicalCase.objects.create(
            patient=self.patient,
            managing_doctor=self.doctor,
        )
        second_doctor = User.objects.create_user("09120000010", role=User.Role.DOCTOR, is_verified=True)
        self.client.force_authenticate(second_doctor)
        response = self.client.get(f"/api/v1/cases/{doctor_case.id}/")
        self.assertEqual(response.status_code, 404)

    def test_second_doctor_cannot_replace_completed_visit(self):
        self.case.status = MedicalCase.Status.SUBMITTED
        self.case.save()
        Assessment.objects.create(
            case=self.case,
            source=Assessment.Source.DOCTOR,
            author=self.doctor,
            verdict=Assessment.Verdict.NO_SURGERY,
            rationale="نظر پزشک اول برای این پرونده ثبت شده است.",
        )
        second_doctor = User.objects.create_user("09120000009", role=User.Role.DOCTOR, is_verified=True)
        self.client.force_authenticate(second_doctor)
        response = self.client.put(f"/api/v1/cases/{self.case.id}/doctor-assessment/", {
            "verdict": "surgery", "rationale": "پزشک دوم نباید بتواند این نتیجه را جایگزین کند."
        }, format="json")
        self.assertEqual(response.status_code, 403)
        assessment = Assessment.objects.get(case=self.case, source=Assessment.Source.DOCTOR)
        self.assertEqual(assessment.author, self.doctor)
        self.assertEqual(assessment.verdict, Assessment.Verdict.NO_SURGERY)

    def test_submit_requires_questionnaire_and_image(self):
        self.client.force_authenticate(self.patient)
        response = self.client.post(f"/api/v1/cases/{self.case.id}/submit/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_patient_can_delete_own_draft(self):
        self.client.force_authenticate(self.patient)
        response = self.client.delete(f"/api/v1/cases/{self.case.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(MedicalCase.objects.filter(pk=self.case.id).exists())

    def test_patient_cannot_delete_submitted_case(self):
        self.case.status = MedicalCase.Status.SUBMITTED
        self.case.save()
        self.client.force_authenticate(self.patient)
        response = self.client.delete(f"/api/v1/cases/{self.case.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(MedicalCase.objects.filter(pk=self.case.id).exists())

    def test_patient_hides_clinical_verdicts_but_sees_final_insurance_decision(self):
        self.case.status = MedicalCase.Status.COMPLETED
        self.case.save()
        Assessment.objects.create(case=self.case, source=Assessment.Source.AI, verdict="surgery", rationale="تحلیل هوشمند برای بیمار نمایش داده نمی‌شود.")
        Assessment.objects.create(case=self.case, source=Assessment.Source.DOCTOR, author=self.doctor, verdict="no_surgery", rationale="نظر پزشک برای بیمار نمایش داده نمی‌شود.")
        InsuranceDecision.objects.create(case=self.case, reviewer=self.insurance, decision="approved", rationale="مدارک برای تأیید پوشش جراحی کافی است.")
        self.client.force_authenticate(self.patient)
        response = self.client.get(f"/api/v1/cases/{self.case.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assessments"], [])
        self.assertEqual(response.data["insurance_decision"]["decision"], "approved")
        self.assertEqual(response.data["insurance_decision"]["rationale"], "مدارک برای تأیید پوشش جراحی کافی است.")
        self.assertNotIn("reviewer", response.data["insurance_decision"])

        self.client.force_authenticate(self.doctor)
        doctor_response = self.client.get(f"/api/v1/cases/{self.case.id}/")
        self.assertEqual(doctor_response.data["insurance_decision"]["decision"], "approved")

    def test_unverified_doctor_cannot_access_cases(self):
        unverified = User.objects.create_user("09120000008", role=User.Role.DOCTOR, is_verified=False)
        self.client.force_authenticate(unverified)
        response = self.client.get("/api/v1/cases/")
        self.assertEqual(response.status_code, 403)

    def test_verified_insurance_can_finalize_after_doctor_assessment(self):
        self.case.status = MedicalCase.Status.UNDER_REVIEW
        self.case.save()
        Assessment.objects.create(case=self.case, source=Assessment.Source.DOCTOR, author=self.doctor, verdict="surgery", rationale="با توجه به یافته‌ها جراحی پیشنهاد می‌شود.")
        self.client.force_authenticate(self.insurance)
        response = self.client.put(f"/api/v1/cases/{self.case.id}/insurance-decision/", {
            "decision": "approved", "rationale": "مدارک و نظر پزشک برای صدور مجوز کافی است."
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.case.refresh_from_db()
        self.assertEqual(self.case.status, MedicalCase.Status.COMPLETED)
        self.assertEqual(InsuranceDecision.objects.get(case=self.case).reviewer, self.insurance)

    def test_xray_file_requires_case_access(self):
        image = XRayImage.objects.create(
            case=self.case,
            image=SimpleUploadedFile("knee.png", b"test-image-bytes", content_type="image/png"),
        )
        url = f"/api/v1/images/{image.id}/file/"

        self.client.force_authenticate(self.patient)
        allowed = self.client.get(url)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed["Content-Type"], "image/png")
        self.assertEqual(allowed["Cache-Control"], "private, no-store")

        self.client.force_authenticate(self.other_patient)
        denied = self.client.get(url)
        self.assertEqual(denied.status_code, 403)


@override_settings(
    OPENAI_API_KEY="test-key",
    OPENAI_API_URL="https://api.openai.test/v1/chat/completions",
    OPENAI_MODEL="gpt-test",
)
class OpenAIProviderTests(TestCase):
    def setUp(self):
        patient = User.objects.create_user("09120000005", role=User.Role.PATIENT, is_verified=True)
        self.case = MedicalCase.objects.create(patient=patient)
        QuestionnaireResponse.objects.create(
            case=self.case,
            pain_level=7,
            pain_duration_months=18,
            mobility_limit="severe",
            previous_treatments=["فیزیوتراپی"],
            has_night_pain=True,
        )
        XRayImage.objects.create(
            case=self.case,
            image=SimpleUploadedFile("knee.png", b"test-image-bytes", content_type="image/png"),
        )
        WOMACResponse.objects.create(case=self.case, responses={}, pain_score=10, stiffness_score=4, function_score=34, total_score=48, normalized_score=50)

    @patch("apps.cases.services.requests.post")
    def test_structured_openai_result_creates_ai_assessment(self, post):
        api_response = Mock()
        api_response.raise_for_status.return_value = None
        api_response.json.return_value = {
            "choices": [{"message": {"content": json.dumps({
                "verdict": "inconclusive",
                "kl_grade": 2,
                "requires_further_examination": True,
                "rationale": "کیفیت و نمای تصویر برای توصیه قطعی جراحی کافی نیست.",
                "confidence": 0.42,
            }, ensure_ascii=False)}}]
        }
        post.return_value = api_response

        assessment = request_ai_assessment(self.case)

        self.assertEqual(assessment.source, Assessment.Source.AI)
        self.assertEqual(assessment.model_version, "gpt-test")
        self.assertEqual(assessment.kl_grade, 2)
        self.assertIn("نیاز به بررسی تکمیلی: بله", assessment.rationale)
        payload = post.call_args.kwargs["json"]
        self.assertFalse(payload["store"])
        self.assertEqual(
            payload["response_format"]["json_schema"]["schema"]["properties"]["kl_grade"]["type"],
            "integer",
        )
        self.assertTrue(any(item.get("image_url", {}).get("url", "").startswith("data:image/png;base64,") for item in payload["messages"][1]["content"]))
        clinical_context = json.loads(payload["messages"][1]["content"][0]["text"].split("\n", 1)[1])
        self.assertIn("had_intra_articular_injection", clinical_context)
        self.assertEqual(len(clinical_context["womac"]["responses"]), 24)


class WOMACScoringTests(TestCase):
    def test_all_subscales_and_normalized_total_are_calculated(self):
        patient = User.objects.create_user("09120000006", role=User.Role.PATIENT, is_verified=True)
        case = MedicalCase.objects.create(patient=patient)
        responses = {}
        for item_id, _ in WOMAC_ITEMS["pain"]:
            responses[item_id] = 1
        for item_id, _ in WOMAC_ITEMS["stiffness"]:
            responses[item_id] = 2
        for item_id, _ in WOMAC_ITEMS["function"]:
            responses[item_id] = 3
        supplemental = {item_id: 4 for item_id, _label in KNEE_SUPPLEMENTAL_ITEMS}
        serializer = WOMACSerializer(data={"responses": responses, "supplemental_responses": supplemental})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        result = serializer.save(case=case)
        self.assertEqual(result.pain_score, 5)
        self.assertEqual(result.stiffness_score, 4)
        self.assertEqual(result.function_score, 51)
        self.assertEqual(result.total_score, 60)
        self.assertEqual(float(result.normalized_score), 62.5)
        self.assertEqual(result.supplemental_responses, supplemental)
        self.assertEqual(WOMACSerializer(result).data["health_score"], 37.5)

    def test_supplemental_answers_are_optional_and_validated_separately(self):
        responses = {item_id: 0 for items in WOMAC_ITEMS.values() for item_id, _label in items}
        serializer = WOMACSerializer(data={"responses": responses, "supplemental_responses": {"unknown": 2}})
        self.assertFalse(serializer.is_valid())
        self.assertIn("supplemental_responses", serializer.errors)

    def test_incomplete_womac_is_rejected(self):
        serializer = WOMACSerializer(data={"responses": {"p1": 2}})
        self.assertFalse(serializer.is_valid())
