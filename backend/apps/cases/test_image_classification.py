import copy
import io
import json
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from PIL import Image
from django.db import IntegrityError, close_old_connections, transaction
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.accounts.models import User
from .image_classification import ImageClassificationProvider, check_slot, classify_image, image_write
from .models import MedicalCase, QuestionnaireResponse, WOMACResponse, XRayImage
from .serializers import XRayImageSerializer
from .services import AIProviderError, request_ai_assessment


def png():
    from django.core.files.uploadedfile import SimpleUploadedFile
    stream = io.BytesIO()
    Image.new("RGB", (10, 10)).save(stream, "PNG")
    return SimpleUploadedFile("no-side-evidence.png", stream.getvalue(), content_type="image/png")


def detection(image_id, **changes):
    return {"image_id": str(image_id), "side": "right", "view": "frontal", "is_knee_xray": True,
            "quality": "adequate", "visible_marker": "R", "ambiguous_evidence": False,
            "reason": "Visible R marker and frontal knee anatomy.", **changes}


class ClassificationValidationTests(SimpleTestCase):
    def test_results_are_mapped_by_id_even_when_reversed(self):
        results = ImageClassificationProvider.validate_results({"results": [detection("b", side="left", visible_marker="L"), detection("a")]}, ["a", "b"])
        self.assertEqual(results["a"]["side"], "right")
        self.assertEqual(results["b"]["side"], "left")

    def test_rejects_missing_duplicate_foreign_ids_wrong_types_and_enums(self):
        valid = detection("a")
        malformed = [None, [], {}, {"results": None}, {"results": []}, {"results": [valid, valid]},
                     {"results": [detection("foreign")]}, {"results": [dict(valid, side="both")]},
                     {"results": [dict(valid, view="ap")]}, {"results": [dict(valid, quality="good")]},
                     {"results": [dict(valid, is_knee_xray="true")]}, {"results": [dict(valid, ambiguous_evidence=0)]},
                     {"results": [dict(valid, reason=" ")]}, {"results": [dict(valid, image_id=["a"])]},
                     {"results": [dict(valid, extra="unsupported")]}, {"results": [dict(valid, visible_marker="left")]},
                     {"results": [dict(valid, quality="unusable")]}, {"results": [dict(valid, is_knee_xray=False)]},
                     {"results": [dict(valid, ambiguous_evidence=True)]}, {"results": [dict(valid, side="left")]},
                     {"results": [None]}]
        for data in malformed:
            with self.subTest(data=data), self.assertRaises(AIProviderError):
                ImageClassificationProvider.validate_results(data, ["a"])

    def test_unknown_bilateral_and_non_knee_outputs_are_supported(self):
        for changes in ({"side": "unknown", "view": "unknown", "visible_marker": "none", "quality": "limited"},
                        {"side": "bilateral", "visible_marker": "both"},
                        {"is_knee_xray": False, "side": "unknown", "view": "unknown", "quality": "unusable"}):
            self.assertIn("a", ImageClassificationProvider.validate_results({"results": [detection("a", **changes)]}, ["a"]))


@override_settings(OPENAI_API_KEY="test-server-key", OPENAI_MODEL="test-classifier")
class OrganizedImageTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)
        self.patient = User.objects.create_user("09121110001", role="patient", is_verified=True)
        self.other = User.objects.create_user("09121110002", role="patient", is_verified=True)
        self.doctor = User.objects.create_user("09121110003", role="doctor", is_verified=True)
        self.insurance = User.objects.create_user("09121110004", role="insurance", is_verified=True)
        self.case = MedicalCase.objects.create(patient=self.patient)
        self.client = APIClient()
        self.client.force_authenticate(self.patient)
        self.url = f"/api/v1/cases/{self.case.pk}/"

    def upload(self, side="right", view="frontal", **extra):
        return self.client.post(self.url + "images/", {"image": png(), "declared_side": side, "declared_view": view, **extra}, format="multipart")

    def image(self, **kwargs):
        response = self.upload(**kwargs)
        self.assertEqual(response.status_code, 201, response.data)
        return XRayImage.objects.get(pk=response.data["id"])

    def confirm(self, image, side="right", view="frontal", reason=""):
        return self.client.post(f"/api/v1/images/{image.pk}/confirm/", {"side": side, "view": view, "reason": reason}, format="json")

    def ready(self):
        QuestionnaireResponse.objects.create(case=self.case, pain_level=0, pain_duration_months=1, mobility_limit="none")
        WOMACResponse.objects.create(case=self.case)

    def mock_result(self, image, **changes):
        return patch("apps.cases.image_classification.ImageClassificationProvider.classify", return_value={str(image.pk): detection(image.pk, **changes)})

    def classify_endpoint(self, image):
        return self.client.post(f"/api/v1/images/{image.pk}/classify/", {}, format="json")

    def test_four_slots_and_server_enforced_duplicate_limit(self):
        for side in ("right", "left"):
            for view in ("frontal", "lateral"):
                image = self.image(side=side, view=view)
                self.assertEqual(image.slot_key, f"{side}_{view}")
                self.assertTrue(image.organized)
                self.assertEqual(image.detected_side, "unknown")
                self.assertIsNone(image.confirmed_at)
        response = self.upload()
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("slot_key", response.data["errors"])
        self.assertEqual(self.case.images.count(), 4)

    def test_unilateral_submission_needs_confirmation_but_not_four_images(self):
        self.ready()
        image = self.image()
        with patch("apps.cases.views.request_ai_assessment") as assess:
            self.assertEqual(self.client.post(self.url + "submit/").status_code, 400)
            self.assertEqual(self.confirm(image).status_code, 200)
            self.assertEqual(self.client.post(self.url + "submit/").status_code, 200)
            assess.assert_called_once()
        self.assertEqual(self.case.images.count(), 1)

    def test_matching_ai_result_still_requires_human_confirmation_for_new_upload(self):
        image = self.image()
        with self.mock_result(image):
            response = self.classify_endpoint(image)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["classification_status"], "completed")
        self.assertIsNone(response.data["confirmed_at"])
        self.ready()
        self.assertEqual(self.client.post(self.url + "submit/").status_code, 400)

    def test_unknown_quality_and_conflict_preserve_declaration_and_allow_correction(self):
        image = self.image()
        with self.mock_result(image, side="unknown", view="unknown", visible_marker="none", quality="limited", reason="No marker; projection obscured."):
            response = self.classify_endpoint(image)
        self.assertEqual(response.data["declared_side"], "right")
        self.assertEqual(response.data["classification_status"], "needs_confirmation")
        self.assertEqual(response.data["detected_side"], "unknown")
        self.assertEqual(self.confirm(image, side="unknown", view="unknown").status_code, 400)
        self.assertEqual(self.confirm(image, side="unknown", view="unknown", reason="No visible marker; specialist review requested.").status_code, 200)
        image.refresh_from_db()
        self.assertIsNone(image.slot_key)
        self.assertEqual(image.effective_side, "unknown")
        self.assertEqual(image.confirmed_by, self.patient)
        self.assertEqual(image.confirmation_source, "manual")
        self.assertEqual(image.original_ai_result["side"], "unknown")

    def test_ai_conflict_never_moves_image_and_manual_correction_reserves_new_slot(self):
        image = self.image()
        with self.mock_result(image, side="left", view="lateral", visible_marker="L"):
            response = self.classify_endpoint(image)
        self.assertEqual(response.data["slot_key"], "right_frontal")
        self.assertEqual(response.data["classification_status"], "needs_confirmation")
        response = self.confirm(image, side="left", view="lateral")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["slot_key"], "left_lateral")
        self.assertEqual(response.data["declared_side"], "right")
        self.assertEqual(response.data["detected_side"], "left")
        self.assertEqual(response.data["original_ai_result"]["view"], "lateral")

    def test_duplicate_manual_assignment_is_rejected_without_losing_confirmation(self):
        right = self.image()
        left = self.image(side="left")
        self.confirm(left, side="left")
        self.assertEqual(self.confirm(left, side="right").status_code, 400)
        left.refresh_from_db()
        self.assertEqual(left.confirmed_side, "left")
        self.assertEqual(self.case.images.count(), 2)

    def test_bilateral_remains_in_review_until_explicit_confirmation(self):
        image = self.image()
        with self.mock_result(image, side="bilateral", visible_marker="both"):
            response = self.classify_endpoint(image)
        self.assertEqual(response.data["classification_status"], "needs_confirmation")
        self.assertEqual(response.data["slot_key"], "right_frontal")
        response = self.confirm(image, side="bilateral")
        self.assertIsNone(response.data["slot_key"])
        self.assertEqual(response.data["effective_side"], "bilateral")

    def test_replacement_is_atomic_new_id_and_resets_ai_and_confirmation(self):
        image = self.image()
        self.confirm(image)
        path = Path(image.image.path)
        invalid = self.client.post(self.url + "images/", {"image": png(), "declared_side": "bad", "replace_image_id": str(image.pk)}, format="multipart")
        self.assertEqual(invalid.status_code, 400)
        self.assertTrue(path.exists())
        with self.captureOnCommitCallbacks(execute=True):
            response = self.upload(replace_image_id=str(image.pk))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotEqual(response.data["id"], str(image.pk))
        self.assertFalse(path.exists())
        self.assertEqual(self.case.images.count(), 1)
        self.assertIsNone(response.data["confirmed_at"])
        self.assertEqual(response.data["original_ai_result"], {})
        self.assertEqual(self.upload(replace_image_id=str(image.pk)).status_code, 400)

    def test_replacement_cannot_delete_image_from_another_case_or_slot(self):
        image = self.image()
        self.assertEqual(self.upload(side="left", replace_image_id=str(image.pk)).status_code, 400)
        other_case = MedicalCase.objects.create(patient=self.patient)
        other_image = XRayImage.objects.create(case=other_case, image=png())
        self.assertEqual(self.upload(replace_image_id=str(other_image.pk)).status_code, 400)
        self.assertEqual(self.case.images.count(), 1)

    @override_settings(OPENAI_API_KEY="")
    def test_unavailable_provider_retains_image_allows_manual_confirmation_and_retry(self):
        image = self.image()
        response = self.classify_endpoint(image)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["classification_error"], "provider_unavailable")
        self.assertTrue(Path(image.image.path).exists())
        self.assertEqual(self.confirm(image).status_code, 200)
        with override_settings(OPENAI_API_KEY="retry-key"), self.mock_result(image):
            self.assertEqual(self.classify_endpoint(image).status_code, 200)
        image.refresh_from_db()
        self.assertEqual(image.classification_error, "")
        self.assertIsNotNone(image.confirmed_at)

    def test_provider_failure_and_invalid_results_are_persisted_without_deleting_file(self):
        image = self.image()
        for result in ({}, {str(image.pk): detection("foreign")}, {str(image.pk): detection(image.pk, side="invalid")}):
            with patch("apps.cases.image_classification.ImageClassificationProvider.classify", return_value=result):
                response = self.classify_endpoint(image)
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.data["classification_status"], "failed")
            self.assertEqual(response.data["original_ai_result"], {})
            self.assertTrue(Path(image.image.path).exists())
        with patch("apps.cases.image_classification.requests.post", side_effect=requests.Timeout):
            self.assertEqual(self.classify_endpoint(image).status_code, 502)

    def test_late_classification_cannot_overwrite_human_confirmation(self):
        image = self.image()
        def during_request(images):
            self.assertEqual(self.confirm(image, side="left", view="lateral").status_code, 200)
            return {str(image.pk): detection(image.pk)}
        with patch("apps.cases.image_classification.ImageClassificationProvider.classify", side_effect=during_request):
            self.assertEqual(self.classify_endpoint(image).status_code, 409)
        image.refresh_from_db()
        self.assertEqual(image.effective_side, "left")
        self.assertEqual(image.detected_side, "unknown")
        self.assertEqual(image.classification_status, "completed")

    def test_late_response_cannot_overwrite_replacement(self):
        image = self.image()
        def during_request(images):
            self.assertEqual(self.upload(replace_image_id=str(image.pk)).status_code, 201)
            return {str(image.pk): detection(image.pk)}
        with patch("apps.cases.image_classification.ImageClassificationProvider.classify", side_effect=during_request):
            self.assertEqual(self.classify_endpoint(image).status_code, 409)
        replacement = self.case.images.get()
        self.assertNotEqual(image.pk, replacement.pk)
        self.assertEqual(replacement.detected_side, "unknown")

    def test_newer_retry_supersedes_older_result_and_original_ai_output_is_preserved(self):
        image = self.image()
        def retry(images):
            with self.mock_result(image, side="left", visible_marker="L"):
                classify_image(image, "key")
            return {str(image.pk): detection(image.pk)}
        with patch("apps.cases.image_classification.ImageClassificationProvider.classify", side_effect=retry):
            self.assertEqual(self.classify_endpoint(image).status_code, 409)
        image.refresh_from_db()
        original = copy.deepcopy(image.original_ai_result)
        self.assertEqual(image.detected_side, "left")
        with self.mock_result(image):
            self.classify_endpoint(image)
        image.refresh_from_db()
        self.assertEqual(image.detected_side, "right")
        self.assertEqual(image.original_ai_result, original)

    def test_submission_during_inflight_retry_leaves_finalized_record_unchanged(self):
        image = self.image()
        self.confirm(image)
        self.ready()
        def during_request(images):
            with patch("apps.cases.views.request_ai_assessment"):
                self.assertEqual(self.client.post(self.url + "submit/").status_code, 200)
            return {str(image.pk): detection(image.pk, side="left", visible_marker="L")}
        with patch("apps.cases.image_classification.ImageClassificationProvider.classify", side_effect=during_request):
            self.assertEqual(self.classify_endpoint(image).status_code, 409)
        image.refresh_from_db()
        self.assertEqual(image.detected_side, "unknown")
        self.assertEqual(image.effective_side, "right")
        self.assertEqual(image.classification_status, "completed")

    def test_legacy_defaults_keep_view_and_file_and_do_not_invent_side(self):
        image = XRayImage.objects.create(case=self.case, image=png(), view="ap")
        data = XRayImageSerializer(image).data
        self.assertFalse(data["organized"])
        self.assertEqual(data["view"], "ap")
        self.assertEqual(data["declared_side"], "unknown")
        self.assertEqual(data["detected_side"], "unknown")
        self.assertEqual(data["declared_view"], "unknown")
        self.assertEqual(data["classification_status"], "pending")
        self.ready()
        with patch("apps.cases.views.request_ai_assessment"):
            self.assertEqual(self.client.post(self.url + "submit/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/images/{image.pk}/file/").status_code, 200)

    def test_labs_are_unaffected_and_cannot_be_classified_confirmed_or_take_a_slot(self):
        response = self.client.post(self.url + "images/", {"image": png(), "purpose": "lab", "view": "other"}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        image = XRayImage.objects.get(pk=response.data["id"])
        self.assertFalse(image.organized)
        self.assertIsNone(image.slot_key)
        self.assertEqual(self.classify_endpoint(image).status_code, 400)
        self.assertEqual(self.confirm(image).status_code, 400)
        self.assertEqual(self.upload(purpose="lab").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/v1/images/{image.pk}/").status_code, 204)

    def test_permissions_for_anonymous_other_patient_doctors_insurance_and_submitted_case(self):
        image = self.image()
        for user in (None, self.other, self.doctor, self.insurance):
            self.client.force_authenticate(user)
            self.assertIn(self.classify_endpoint(image).status_code, (401, 403))
            self.assertIn(self.confirm(image).status_code, (401, 403))
        self.case.managing_doctor = self.doctor
        self.case.save()
        self.client.force_authenticate(self.doctor)
        with self.mock_result(image):
            self.assertEqual(self.classify_endpoint(image).status_code, 200)
        self.assertEqual(self.confirm(image).status_code, 200)
        self.case.status = "submitted"
        self.case.save()
        for user in (self.patient, self.doctor):
            self.client.force_authenticate(user)
            self.assertEqual(self.classify_endpoint(image).status_code, 403)
            self.assertEqual(self.confirm(image).status_code, 403)
            self.assertIn(self.upload().status_code, (400, 403))
            self.assertEqual(self.client.delete(f"/api/v1/images/{image.pk}/").status_code, 403)

    @patch("apps.cases.image_classification.requests.post")
    def test_provider_receives_ids_but_no_declared_slots_filename_or_questionnaire(self, post):
        image = self.image()
        post.return_value = Mock(json=lambda: {"choices": [{"message": {"content": json.dumps({"results": [detection(image.pk)]})}}]})
        self.assertEqual(self.classify_endpoint(image).status_code, 200)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer test-server-key")
        self.assertFalse(payload["store"])
        text = payload["messages"][1]["content"][0]["text"]
        self.assertEqual(json.loads(text), {"image_id": str(image.pk)})
        self.assertNotIn("declared_side", json.dumps(payload))
        self.assertNotIn(image.image.name, json.dumps(payload))

    def test_requesting_user_credentials_take_precedence_without_using_patient_key(self):
        image = self.image()
        with patch("apps.cases.views.get_api_key", return_value="personal-key") as key, self.mock_result(image), patch("apps.cases.image_classification.ImageClassificationProvider.__init__", return_value=None) as init:
            self.classify_endpoint(image)
            key.assert_called_once_with(self.patient)
            init.assert_called_once_with("personal-key")
        self.case.managing_doctor = self.doctor
        self.case.save()
        self.client.force_authenticate(self.doctor)
        with patch("apps.cases.views.get_api_key", return_value="doctor-key") as key, self.mock_result(image):
            self.classify_endpoint(image)
            key.assert_called_once_with(self.doctor)

    @patch("apps.cases.services.requests.post")
    def test_assessment_images_have_source_labelled_metadata_and_existing_contract(self, post):
        right = self.image()
        left = self.image(side="left")
        self.confirm(left, side="left")
        self.ready()
        post.return_value = Mock(status_code=200, json=lambda: {"choices": [{"message": {"content": json.dumps({"verdict": "inconclusive", "kl_grade": 1, "requires_further_examination": True, "rationale": "A case-level result retaining side attribution for clinical review.", "confidence": .4})}}]})
        assessment = request_ai_assessment(self.case)
        self.assertEqual(assessment.kl_grade, 1)
        content = post.call_args.kwargs["json"]["messages"][1]["content"]
        metadata = [json.loads(row["text"]) for row in content[1:] if row["type"] == "text"]
        self.assertEqual({row["image_id"] for row in metadata}, {str(right.pk), str(left.pk)})
        confirmed = next(row for row in metadata if row["image_id"] == str(left.pk))
        self.assertEqual(confirmed["human_confirmed"]["side"], "left")
        self.assertEqual(confirmed["effective"]["source"], "human_confirmation")
        self.assertEqual(confirmed["ai_detected"]["side"], "unknown")


class ConcurrentSlotTests(TransactionTestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)

    def concurrent_uploads(self, replacement=None):
        patient = replacement.case.patient if replacement else User.objects.create_user("09121110007", role="patient", is_verified=True)
        case = replacement.case if replacement else MedicalCase.objects.create(patient=patient)
        barrier = threading.Barrier(2)
        validate = XRayImageSerializer.validate_image
        def validate_file(serializer, file):
            value = validate(serializer, file)
            barrier.wait(timeout=5)
            return value
        def upload():
            close_old_connections()
            client = APIClient()
            client.force_authenticate(patient)
            try:
                data = {"image": png(), "declared_side": "right", "declared_view": "frontal"}
                if replacement:
                    data["replace_image_id"] = str(replacement.pk)
                response = client.post(f"/api/v1/cases/{case.pk}/images/", data, format="multipart")
                return response.status_code, response.data
            finally:
                close_old_connections()
        with patch.object(XRayImageSerializer, "validate_image", validate_file), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: upload(), range(2)))
        self.assertEqual(sorted(code for code, _ in results), [201, 400], results)
        self.assertEqual(case.images.count(), 1)
        return case.images.get()

    def test_concurrent_upload_requests_reject_duplicate_slot(self):
        self.concurrent_uploads()

    def test_concurrent_replacements_of_same_id_only_replace_once(self):
        patient = User.objects.create_user("09121110008", role="patient", is_verified=True)
        case = MedicalCase.objects.create(patient=patient)
        image = XRayImage.objects.create(case=case, image=png(), slot_key="right_frontal", declared_side="right", declared_view="frontal", organized=True)
        current = self.concurrent_uploads(replacement=image)
        self.assertNotEqual(current.pk, image.pk)
        self.assertFalse(Path(image.image.path).exists())

    def test_concurrent_slot_writers_serialize_and_loser_gets_useful_validation(self):
        patient = User.objects.create_user("09121110005", role="patient")
        case = MedicalCase.objects.create(patient=patient)
        barrier = threading.Barrier(2)
        def assign():
            close_old_connections()
            try:
                barrier.wait(timeout=5)
                with image_write(case.pk) as current:
                    check_slot(current, "right_frontal")
                    time.sleep(.05)
                    XRayImage.objects.create(case=current, image="existing.png", slot_key="right_frontal", organized=True, declared_side="right", declared_view="frontal")
                return "created"
            except ValidationError as error:
                return str(error.detail)
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: assign(), range(2)))
        self.assertEqual(results.count("created"), 1, results)
        self.assertTrue(any("slot_key" in result for result in results), results)
        self.assertEqual(case.images.count(), 1)

    def test_database_constraint_protects_against_writers_bypassing_api(self):
        patient = User.objects.create_user("09121110006", role="patient")
        case = MedicalCase.objects.create(patient=patient)
        XRayImage.objects.create(case=case, image="one.png", slot_key="left_lateral")
        with self.assertRaises(IntegrityError), transaction.atomic():
            XRayImage.objects.create(case=case, image="two.png", slot_key="left_lateral")
