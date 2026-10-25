import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from .intake import previsit_scores
from .models import Assessment, MedicalCase, QuestionnaireResponse, WOMACResponse, XRayImage
from .questionnaires import WOMAC_ITEM_IDS
from .serializers import AssessmentSerializer, QuestionnaireSerializer
from .services import AIProviderError


def answers(**updates):
    return {
        "intake_version": "2.0", "age_years": 62, "gender": "female", "height_cm": "170", "weight_kg": "75",
        "pain_level": 0, "pain_duration_months": 60, "mobility_limit": "none", "affected_knee": "both",
        "worst_pain_month": 0, "walking_pain": 0, "night_pain_frequency": "none", "walking_capacity": "over_10",
        "stair_difficulty": "none", "daily_activity_pain": 0, "sleep_disruption": 0,
        "physiotherapy_sessions": "none", "physiotherapy_effect": "not_tried", "had_intra_articular_injection": False,
        "takes_painkillers": False, "weight_loss_attempted": False, "common_conditions": ["none"],
        "diabetes_status": "none", "smoking_status": "never", "red_flags": ["none"], **updates,
    }


class PrevisitTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)
        self.patient = User.objects.create_user("09121230001", role="patient", is_verified=True)
        self.other = User.objects.create_user("09121230002", role="patient", is_verified=True)
        self.doctor = User.objects.create_user("09121230003", role="doctor", is_verified=True)
        self.insurance = User.objects.create_user("09121230004", role="insurance", is_verified=True)
        self.case = MedicalCase.objects.create(patient=self.patient)
        self.client = APIClient()
        self.client.force_authenticate(self.patient)
        self.url = f"/api/v1/cases/{self.case.pk}/"

    def save_answers(self, **updates):
        data = answers(**updates)
        serializer = QuestionnaireSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        return serializer.save(case=self.case)

    def make_ready(self):
        self.save_answers()
        WOMACResponse.objects.create(case=self.case, responses={key: 0 for key in WOMAC_ITEM_IDS})
        self.add_image()
        self.case.status = MedicalCase.Status.SUBMITTED
        self.case.save()

    def add_image(self, purpose="xray"):
        return XRayImage.objects.create(case=self.case, purpose=purpose, image=SimpleUploadedFile("knee.png", b"image", content_type="image/png"))

    def test_full_form_roundtrip_preserves_zero_pain_and_multiyear_duration(self):
        response = self.client.put(self.url + "questionnaire/", answers(), format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["pain_level"], 0)
        self.assertEqual(response.data["worst_pain_month"], 0)
        self.assertEqual(response.data["walking_pain"], 0)
        self.assertEqual(response.data["pain_duration_months"], 60)
        self.assertEqual(self.client.get(self.url).data["questionnaire"]["affected_knee"], "both")
        self.assertIsNone(self.client.get(self.url).data["previsit_scores"])

    def test_controlled_diabetes_labs_and_medications_roundtrip(self):
        response = self.client.put(self.url + "questionnaire/", answers(common_conditions=["diabetes"], diabetes_status="controlled", fasting_glucose="112.5", hba1c="6.4", takes_painkillers=True, painkillers=["دیکلوفناک", "گاباپنتین", "other"], painkiller_other="نام تجاری بیمار", analgesic_effect="moderate"), format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["fasting_glucose"], "112.50")
        self.assertEqual(response.data["hba1c"], "6.40")
        self.assertEqual(response.data["painkillers"], ["دیکلوفناک", "گاباپنتین", "other"])

    def test_other_values_and_exclusive_none_are_validated(self):
        cases = [
            {"takes_painkillers": True, "painkillers": ["other"], "analgesic_effect": "low"},
            {"red_flags": ["other"]}, {"red_flags": ["none", "fever"]},
            {"common_conditions": ["none", "renal"]},
            {"had_intra_articular_injection": True, "injection_types": ["سایر"], "injection_effect": "none", "injection_last_time": "over_6"},
            {"smoking_status": "former", "smoking_start_date": "2024-01-01", "smoking_end_date": "2023-01-01"},
            {"hba1c": "99"}, {"worst_pain_month": 11},
        ]
        for update in cases:
            with self.subTest(update=update):
                serializer = QuestionnaireSerializer(data=answers(**update))
                self.assertFalse(serializer.is_valid())

    def test_no_medication_and_no_injection_clear_stale_answers(self):
        response = self.client.put(self.url + "questionnaire/", answers(painkillers=["ناپروکسن"], painkiller_other="old", analgesic_effect="high", injection_types=["PRP"], injection_rounds=3, injection_effect="good"), format="json")
        self.assertEqual(response.status_code, 200, response.data)
        for key in ("painkillers", "injection_types"):
            self.assertEqual(response.data[key], [])
        self.assertEqual(response.data["painkiller_other"], "")
        self.assertEqual(response.data["injection_rounds"], 0)

    def test_image_deletion_removes_file_and_checks_ownership_and_status(self):
        image = self.add_image()
        path = Path(image.image.path)
        url = f"/api/v1/images/{image.pk}/"
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.delete(url).status_code, 403)
        self.assertTrue(path.exists())
        self.client.force_authenticate(self.patient)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(path.exists())
        self.assertFalse(XRayImage.objects.filter(pk=image.pk).exists())
        image = self.add_image()
        self.case.status = "submitted"
        self.case.save()
        self.assertEqual(self.client.delete(f"/api/v1/images/{image.pk}/").status_code, 403)

    def test_lab_image_does_not_replace_required_knee_xray(self):
        self.save_answers()
        WOMACResponse.objects.create(case=self.case, responses={key: 0 for key in WOMAC_ITEM_IDS})
        self.add_image(purpose="lab")
        with self.assertRaises(ValueError):
            self.case.submit()
        self.add_image()
        self.case.submit()
        self.assertEqual(self.case.status, "submitted")

    def test_score_extremes_and_red_flags_override_other_results(self):
        self.save_answers(worst_pain_month=10, walking_pain=10, walking_capacity="under_2", stair_difficulty="unable", daily_activity_pain=10, physiotherapy_sessions="10_plus", physiotherapy_effect="none", had_intra_articular_injection=True, injection_types=["PRP"], injection_rounds=3, injection_effect="none", injection_last_time="over_6", takes_painkillers=True, painkillers=["دیکلوفناک"], analgesic_effect="none", red_flags=["fever", "hot_swollen", "wound"])
        scores = previsit_scores(self.case)
        self.assertEqual(scores["a"], 100)
        self.assertEqual(scores["b"], 0)
        self.assertEqual(scores["c"], 100)
        self.assertEqual(scores["color"], "red")

    def test_chronicity_boundaries_and_injection_metadata_does_not_score(self):
        q = self.save_answers()
        for months, expected in ((5, 2), (6, 7), (12, 7), (13, 12), (120, 12)):
            q.pain_duration_months = months
            q.save()
            self.assertEqual(previsit_scores(self.case)["a"], expected)
        before = previsit_scores(self.case)
        q.injection_rounds = 3
        q.injection_last_time = "under_1"
        q.save()
        self.assertEqual(previsit_scores(self.case), before)

    def test_doctor_risk_additions_apply_once_and_cap(self):
        self.save_answers()
        Assessment.objects.create(case=self.case, source="doctor", author=self.doctor, verdict="inconclusive", rationale="معاینه نیاز به تکمیل دارد.", active_infection=True, high_risk_conditions=["anticoagulants", "dvt_pe"])
        self.assertEqual(previsit_scores(self.case)["b"], 80)
        self.assertEqual(previsit_scores(self.case)["action"], "کاهش عوامل خطر پیش از تصمیم جراحی")

    def test_legacy_answers_do_not_receive_fabricated_scores(self):
        QuestionnaireResponse.objects.create(case=self.case, pain_level=3, pain_duration_months=12, mobility_limit="mild")
        self.assertIsNone(previsit_scores(self.case))

    def test_doctor_can_complete_missing_womac_only_once(self):
        self.case.status = "submitted"
        self.case.save()
        self.client.force_authenticate(self.doctor)
        data = {"responses": {key: 4 for key in WOMAC_ITEM_IDS}, "supplemental_responses": {}}
        first = self.client.put(self.url + "womac/", data, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["total_score"], 96)
        second = self.client.put(self.url + "womac/", data, format="json")
        self.assertEqual(second.status_code, 400)

    def test_doctor_exam_roundtrip_and_numeric_limits(self):
        self.make_ready()
        self.client.force_authenticate(self.doctor)
        data = {"verdict": "inconclusive", "rationale": "معاینه و تکمیل ارزیابی لازم است.", "retropatellar_pain": True, "flexion_degrees": 120, "extension_degrees": -5, "ligament_stability": "stable", "limb_alignment": "varus", "standing_xray": True, "compartments": ["medial"], "active_infection": False, "high_risk_conditions": ["none"], "educated_about_tka": True, "realistic_expectations": False}
        result = self.client.put(self.url + "doctor-assessment/", data, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["extension_degrees"], -5)
        self.assertEqual(result.data["compartments"], ["medial"])
        self.assertFalse(AssessmentSerializer(data={**data, "flexion_degrees": 200}).is_valid())

    @override_settings(OPENAI_API_KEY="")
    def test_ai_request_is_doctor_only_and_reports_missing_configuration(self):
        self.make_ready()
        self.assertEqual(self.client.post(self.url + "ai-assessment/").status_code, 403)
        self.client.force_authenticate(self.insurance)
        self.assertEqual(self.client.post(self.url + "ai-assessment/").status_code, 403)
        self.client.force_authenticate(self.doctor)
        self.assertEqual(self.client.post(self.url + "ai-assessment/").status_code, 503)
        self.assertFalse(Assessment.objects.filter(source="ai").exists())

    @override_settings(OPENAI_API_KEY="test")
    @patch("apps.cases.views.request_ai_assessment")
    def test_ai_retry_succeeds_then_reuses_existing_result(self, request):
        self.make_ready()
        self.client.force_authenticate(self.doctor)
        def result(case, api_key=None):
            return Assessment.objects.create(case=case, source="ai", verdict="inconclusive", rationale="پاسخ آزمایشی هوش مصنوعی برای آزمون مسیر درخواست.", kl_grade=2)
        request.side_effect = result
        for _ in range(2):
            response = self.client.post(self.url + "ai-assessment/")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["kl_grade"], 2)
        request.assert_called_once()

    @override_settings(OPENAI_API_KEY="test")
    @patch("apps.cases.views.request_ai_assessment", side_effect=AIProviderError("unavailable"))
    def test_ai_failure_allows_retry_and_preserves_case(self, request):
        self.make_ready()
        self.client.force_authenticate(self.doctor)
        self.assertEqual(self.client.post(self.url + "ai-assessment/").status_code, 502)
        self.case.refresh_from_db()
        self.assertEqual(self.case.status, "submitted")
        self.assertFalse(Assessment.objects.filter(source="ai").exists())

    @override_settings(OPENAI_API_KEY="server-fallback")
    @patch("apps.cases.services.requests.post")
    def test_ai_request_uses_requesting_doctors_saved_key_instead_of_server_key(self, post):
        from apps.accounts.ai_settings import save_api_key
        import json
        self.make_ready()
        doctor_key = "sk-proj-doctor-test-key-1234"
        save_api_key(self.doctor, doctor_key)
        # A patient's credential must not be used by a different requesting user.
        save_api_key(self.patient, "sk-proj-patient-test-key-5678")
        self.client.force_authenticate(self.doctor)
        post.return_value.status_code = 200
        post.return_value.json.return_value = {"choices": [{"message": {"content": json.dumps({
            "verdict": "inconclusive", "kl_grade": 2, "requires_further_examination": True,
            "rationale": "پاسخ آزمایشی سرویس برای بررسی کلید اختصاصی پزشک.", "confidence": 0.5,
        })}}]}
        response = self.client.post(self.url + "ai-assessment/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], f"Bearer {doctor_key}")
        self.assertNotIn(doctor_key, str(response.data))
        self.assertNotIn(doctor_key, str(self.client.get(self.url).data))

    @override_settings(OPENAI_API_KEY="")
    @patch("apps.cases.services.requests.post")
    def test_invalid_user_key_gets_actionable_error_without_echoing_key(self, post):
        from apps.accounts.ai_settings import save_api_key
        self.make_ready()
        self.client.force_authenticate(self.doctor)
        key = "sk-proj-invalid-test-key-1234"
        save_api_key(self.doctor, key)
        post.return_value.status_code = 401
        response = self.client.post(self.url + "ai-assessment/")
        self.assertEqual(response.status_code, 502)
        self.assertIn("تنظیمات", response.data["detail"])
        self.assertNotIn(key, str(response.data))
        self.assertFalse(Assessment.objects.filter(source="ai").exists())
