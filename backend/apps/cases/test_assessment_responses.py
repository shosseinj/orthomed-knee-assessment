import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from apps.accounts.models import User
from .models import Assessment, MedicalCase, QuestionnaireResponse, WOMACResponse
from .services import AIProviderError, OpenAIProvider, request_ai_assessment


@override_settings(OPENAI_API_KEY="test-server-key", OPENAI_MODEL="gpt-5-mini", OPENAI_ASSESSMENT_MAX_COMPLETION_TOKENS=8192)
class AssessmentResponseTests(TestCase):
    def setUp(self):
        user = User.objects.create_user("09501230000", role="patient")
        self.case = MedicalCase.objects.create(patient=user, status="submitted")
        QuestionnaireResponse.objects.create(case=self.case, pain_level=0, pain_duration_months=1, mobility_limit="none")
        WOMACResponse.objects.create(case=self.case, responses={})
        self.result = {"verdict": "inconclusive", "kl_grade": 1, "requires_further_examination": True,
                       "rationale": "پاسخ آزمایشی ساختاریافته برای بررسی مسیر دریافت نتیجه؛ نیاز به بررسی تکمیلی: بله", "confidence": 0.4}

    @patch("apps.cases.services.requests.post")
    def test_reasoning_model_has_room_for_the_answer_and_persists_valid_output(self, post):
        post.return_value.status_code = 200
        post.return_value.json.return_value = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(self.result)}}]}
        saved = request_ai_assessment(self.case)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "gpt-5-mini")
        self.assertEqual(payload["max_completion_tokens"], 8192)
        self.assertEqual(saved.rationale, self.result["rationale"])
        self.assertEqual(saved.kl_grade, 1)
        self.assertEqual(saved.model_version, "gpt-5-mini")

    @patch("apps.cases.services.requests.post")
    def test_length_limited_output_is_rejected_even_if_its_json_looks_complete(self, post):
        post.return_value.status_code = 200
        for content in ("", json.dumps(self.result)):
            with self.subTest(content=bool(content)):
                post.return_value.json.return_value = {"choices": [{"finish_reason": "length", "message": {"content": content}}]}
                with self.assertRaisesMessage(AIProviderError, "completion token budget"):
                    request_ai_assessment(self.case)
                self.assertFalse(Assessment.objects.exists())

    @patch("apps.cases.services.requests.post")
    def test_empty_refused_and_malformed_answers_never_become_assessments(self, post):
        post.return_value.status_code = 200
        invalid = [None, [], {}, {"choices": []}, {"choices": [None]}, {"choices": [{"message": None}]}]
        for content in (None, "", " ", "not json", "[]", "null", json.dumps({**self.result, "confidence": True}), json.dumps({**self.result, "kl_grade": 5})):
            invalid.append({"choices": [{"finish_reason": "stop", "message": {"content": content}}]})
        invalid.append({"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(self.result), "refusal": "Cannot provide this result"}}]})
        for body in invalid:
            with self.subTest(body=body):
                post.return_value.json.return_value = body
                with self.assertRaises(AIProviderError):
                    request_ai_assessment(self.case)
                self.assertFalse(Assessment.objects.exists())

    @override_settings(OPENAI_ASSESSMENT_MAX_COMPLETION_TOKENS=16384)
    @patch("apps.cases.services.requests.post")
    def test_assessment_budget_can_be_configured_on_the_server(self, post):
        post.return_value.status_code = 200
        post.return_value.json.return_value = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(self.result)}}]}
        OpenAIProvider().assess(self.case)
        self.assertEqual(post.call_args.kwargs["json"]["max_completion_tokens"], 16384)
