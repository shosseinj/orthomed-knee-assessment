import base64
import json

import requests
from django.conf import settings

from .models import Assessment
from .questionnaires import KNEE_SUPPLEMENTAL_ITEMS, WOMAC_ITEMS
from .intake import previsit_scores


class AIProviderError(RuntimeError):
    """Raised when an AI provider returns an unusable response."""


class AIAssessmentProvider:
    def assess(self, case):
        raise NotImplementedError


class OpenAIProvider(AIAssessmentProvider):
    """OpenAI Chat Completions vision adapter with a strict JSON result."""

    def __init__(self, api_key=None):
        self.api_key = settings.OPENAI_API_KEY if api_key is None else api_key

    system_prompt = """
شما یک ابزار پشتیبان تصمیم بالینی برای ارزیابی اولیه آرتروز زانو هستید، نه جایگزین پزشک.
تصاویر رادیولوژی و پاسخ‌های پرسش‌نامه را مستقل بررسی کنید. فقط بر اساس شواهد موجود پاسخ دهید.
اگر کیفیت تصویر، نمای تصویربرداری یا داده بالینی کافی نیست، verdict را inconclusive انتخاب کنید.
اگر حداقل یکی از تصاویر، رادیوگرافی زانو است، بدون توجه به کیفیت یا استاندارد بودن نما باید بهترین
برآورد ممکن از درجه Kellgren–Lawrence را به‌صورت یک عدد صحیح از ۰ تا ۴ در kl_grade برگردانید؛
کیفیت پایین تصویر مجوز حذف درجه KL نیست. عدم قطعیت را با confidence منعکس کنید،
requires_further_examination را مشخص کنید و در rationale صریحاً
بنویسید «نیاز به بررسی تکمیلی: بله» یا «نیاز به بررسی تکمیلی: خیر» و در صورت پاسخ مثبت، دلیل و بررسی
پیشنهادی مانند رادیوگرافی ایستاده استاندارد یا معاینه پزشک را توضیح دهید.
نباید قطعیت کاذب، تشخیص قطعی یا توصیه مستقیم درمانی ارائه کنید. rationale باید فارسی، روشن و مستند
به یافته‌های قابل مشاهده و پاسخ‌های بیمار باشد. خروجی باید دقیقاً با JSON schema ارائه‌شده منطبق باشد.
""".strip()

    response_schema = {
        "name": "knee_surgery_assessment",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "verdict": {"type": "string", "enum": ["surgery", "no_surgery", "inconclusive"]},
                "kl_grade": {"type": "integer", "minimum": 0, "maximum": 4},
                "requires_further_examination": {"type": "boolean"},
                "rationale": {"type": "string", "minLength": 20},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": ["verdict", "kl_grade", "requires_further_examination", "rationale", "confidence"],
            "additionalProperties": False,
        },
    }

    @staticmethod
    def _image_content(image):
        image.image.open("rb")
        try:
            encoded = base64.b64encode(image.image.read()).decode("ascii")
        finally:
            image.image.close()
        extension = image.image.name.rsplit(".", 1)[-1].lower()
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(extension, "image/jpeg")
        return {
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{encoded}", "detail": "high"},
        }

    def assess(self, case):
        questionnaire = case.questionnaire
        womac_questions = {
            item_id: {"question": label, "answer_0_to_4": case.womac.responses.get(item_id)}
            for items in WOMAC_ITEMS.values()
            for item_id, label in items
        }
        supplemental_questions = {
            item_id: {"question": label, "answer_0_to_4": case.womac.supplemental_responses.get(item_id)}
            for item_id, label in KNEE_SUPPLEMENTAL_ITEMS
            if item_id in case.womac.supplemental_responses
        }
        clinical_context = {
            "age_years": questionnaire.age_years,
            "gender": questionnaire.gender,
            "bmi": questionnaire.bmi,
            "underlying_conditions": questionnaire.underlying_conditions,
            "medications": questionnaire.medications,
            "pain_level_0_to_10": questionnaire.pain_level,
            "pain_duration_months": questionnaire.pain_duration_months,
            "mobility_limit": questionnaire.mobility_limit,
            "previous_treatments": questionnaire.previous_treatments,
            "conservative_treatment_rounds": questionnaire.conservative_treatment_rounds,
            "conservative_duration_months": questionnaire.conservative_duration_months,
            "conservative_response": questionnaire.conservative_response,
            "had_intra_articular_injection": questionnaire.had_intra_articular_injection,
            "injection_rounds": questionnaire.injection_rounds,
            "injection_types": questionnaire.injection_types,
            "daily_life_impact": questionnaire.daily_life_impact,
            "smoking_status": questionnaire.smoking_status,
            "diabetes_status": questionnaire.diabetes_status,
            "has_night_pain": questionnaire.has_night_pain,
            "uses_walking_aid": questionnaire.uses_walking_aid,
            "additional_notes": questionnaire.additional_notes,
            "womac": {
                "pain_0_to_20": case.womac.pain_score,
                "stiffness_0_to_8": case.womac.stiffness_score,
                "function_0_to_68": case.womac.function_score,
                "total_0_to_96": case.womac.total_score,
                "normalized_0_to_100": float(case.womac.normalized_score),
                "inverse_health_0_to_100": round(100 - float(case.womac.normalized_score), 2),
                "instrument_status": "provisional_persian_wording",
                "responses": womac_questions,
            },
            "supplemental_knee_symptoms_not_part_of_womac": supplemental_questions,
        }
        from .serializers import AssessmentSerializer, QuestionnaireSerializer
        clinical_context["previsit_questionnaire"] = QuestionnaireSerializer(questionnaire).data
        clinical_context["previsit_scores"] = previsit_scores(case)
        doctor = case.assessments.filter(source=Assessment.Source.DOCTOR).first()
        if doctor:
            clinical_context["doctor_examination"] = AssessmentSerializer(doctor).data
        content = [{
            "type": "text",
            "text": "داده بالینی بیمار:\n" + json.dumps(clinical_context, ensure_ascii=False),
        }]
        for image in case.images.all():
            content.append({"type": "text", "text": "تصویر آزمایش (رادیوگرافی نیست)" if image.purpose == "lab" else "رادیوگرافی زانو"})
            content.append(self._image_content(image))
        payload = {
            "model": settings.OPENAI_MODEL,
            "store": False,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_schema", "json_schema": self.response_schema},
            "max_completion_tokens": 900,
        }
        try:
            response = requests.post(
                settings.OPENAI_API_URL,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=120,
            )
            if response.status_code == 401:
                raise AIProviderError("کلید OpenAI پذیرفته نشد؛ آن را در تنظیمات بررسی یا جایگزین کنید.")
            if response.status_code == 429:
                raise AIProviderError("سقف مصرف یا تعداد درخواست‌های OpenAI رسیده است؛ اعتبار و محدودیت حساب خود را بررسی کنید.")
            response.raise_for_status()
            body = response.json()
            result = json.loads(body["choices"][0]["message"]["content"])
        except (requests.RequestException, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise AIProviderError("OpenAI returned an invalid assessment response.") from exc

        if result.get("verdict") not in Assessment.Verdict.values:
            raise AIProviderError("OpenAI returned an unsupported verdict.")
        kl_grade = result.get("kl_grade")
        requires_further_examination = result.get("requires_further_examination")
        confidence = result.get("confidence")
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise AIProviderError("OpenAI returned an invalid confidence.")
        if type(kl_grade) is not int or not 0 <= kl_grade <= 4:
            raise AIProviderError("OpenAI returned an invalid KL grade.")
        if type(requires_further_examination) is not bool:
            raise AIProviderError("OpenAI returned an invalid further-examination flag.")
        if not isinstance(result.get("rationale"), str) or len(result["rationale"].strip()) < 20:
            raise AIProviderError("OpenAI returned an invalid rationale.")
        return result


def request_ai_assessment(case, api_key=None):
    """Synchronous MVP seam; invoke this through a task queue in production."""
    api_key = settings.OPENAI_API_KEY if api_key is None else api_key
    if not api_key:
        return None
    result = OpenAIProvider(api_key).assess(case)
    rationale = result["rationale"].strip()
    follow_up_label = "بله" if result["requires_further_examination"] else "خیر"
    if "نیاز به بررسی تکمیلی:" not in rationale:
        rationale = f"{rationale}\nنیاز به بررسی تکمیلی: {follow_up_label}"
    return Assessment.objects.update_or_create(
        case=case,
        source=Assessment.Source.AI,
        defaults={
            "verdict": result["verdict"],
            "kl_grade": result["kl_grade"],
            "rationale": rationale,
            "confidence": result["confidence"],
            "model_name": "OpenAI",
            "model_version": settings.OPENAI_MODEL,
        },
    )[0]
