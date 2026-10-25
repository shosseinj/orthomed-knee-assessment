from django.conf import settings
from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import PatientIdentitySerializer, UserSerializer
from .models import Assessment, DoctorPatient, InsuranceDecision, MedicalCase, QuestionnaireResponse, WOMACResponse, XRayImage
from .questionnaires import KNEE_SUPPLEMENTAL_ITEM_IDS, KNEE_SUPPLEMENTAL_ITEMS, WOMAC_ITEM_IDS, WOMAC_ITEMS
from .intake import COMMON_CONDITIONS, RED_FLAGS, PAINKILLERS, HIGH_RISK, COMPARTMENTS, previsit_scores


def selection_field(options):
    return serializers.ListField(child=serializers.ChoiceField(choices=options), required=False, allow_empty=True)


def check_exclusive(values, field):
    if "none" in values.get(field, []) and len(values[field]) > 1:
        raise serializers.ValidationError({field: "گزینه هیچ‌کدام با سایر گزینه‌ها قابل انتخاب نیست."})


class QuestionnaireSerializer(serializers.ModelSerializer):
    bmi = serializers.FloatField(read_only=True)
    common_conditions = selection_field(COMMON_CONDITIONS)
    red_flags = selection_field(RED_FLAGS)
    painkillers = selection_field(PAINKILLERS)
    underlying_conditions = serializers.ListField(
        child=serializers.CharField(max_length=180, trim_whitespace=True),
        allow_empty=True,
        max_length=50,
        required=False,
    )
    medications = serializers.ListField(
        child=serializers.CharField(max_length=240, trim_whitespace=True),
        allow_empty=True,
        max_length=50,
        required=False,
    )

    class Meta:
        model = QuestionnaireResponse
        exclude = ("id", "case")
        read_only_fields = ("updated_at",)

    @staticmethod
    def _unique_selections(values):
        return list(dict.fromkeys(value for value in values if value))

    def validate_underlying_conditions(self, values):
        return self._unique_selections(values)

    def validate_medications(self, values):
        return self._unique_selections(values)

    def validate(self, attrs):
        for field in ("common_conditions", "red_flags"):
            check_exclusive(attrs, field)
        if attrs.get("intake_version") != "2.0":
            return attrs
        required = ("age_years", "gender", "height_cm", "weight_kg", "affected_knee", "worst_pain_month", "walking_pain", "night_pain_frequency", "walking_capacity", "stair_difficulty", "daily_activity_pain", "sleep_disruption", "physiotherapy_sessions", "physiotherapy_effect", "takes_painkillers", "weight_loss_attempted", "common_conditions", "red_flags")
        errors = {key: "پاسخ این سؤال الزامی است." for key in required if attrs.get(key) is None or attrs.get(key) == "" or attrs.get(key) == []}
        for key in ("height_cm", "weight_kg"):
            if attrs.get(key) is not None and attrs[key] <= 0:
                errors[key] = "مقدار باید بزرگ‌تر از صفر باشد."
        if attrs.get("had_intra_articular_injection"):
            for key in ("injection_types", "injection_effect", "injection_last_time"):
                if not attrs.get(key):
                    errors[key] = "اطلاعات تزریق را تکمیل کنید."
            if "سایر" in attrs.get("injection_types", []) and not attrs.get("injection_other", "").strip():
                errors["injection_other"] = "نوع تزریق را بنویسید."
            if "سایر" not in attrs.get("injection_types", []):
                attrs["injection_other"] = ""
        else:
            attrs.update(injection_types=[], injection_other="", injection_rounds=0, injection_effect="not_tried", injection_last_time="")
        if attrs.get("takes_painkillers"):
            if not attrs.get("painkillers") or not attrs.get("analgesic_effect"):
                errors["painkillers"] = "نوع مسکن و میزان اثر آن را انتخاب کنید."
            if "other" in attrs.get("painkillers", []) and not attrs.get("painkiller_other", "").strip():
                errors["painkiller_other"] = "نام مسکن را بنویسید."
            if "other" not in attrs.get("painkillers", []):
                attrs["painkiller_other"] = ""
        else:
            attrs.update(painkillers=[], painkiller_other="", analgesic_effect="")
        if attrs.get("weight_loss_attempted") and not attrs.get("weight_loss_effect"):
            errors["weight_loss_effect"] = "اثر کاهش وزن را انتخاب کنید."
        if not attrs.get("weight_loss_attempted"):
            attrs["weight_loss_effect"] = ""
        if "other" in attrs.get("red_flags", []) and not attrs.get("red_flags_other", "").strip():
            errors["red_flags_other"] = "علامت هشدار را توضیح دهید."
        if "other" not in attrs.get("red_flags", []):
            attrs["red_flags_other"] = ""
        if attrs.get("physiotherapy_sessions") == "none":
            attrs["physiotherapy_effect"] = "not_tried"
        if attrs.get("diabetes_status") == "none":
            if "diabetes" in attrs.get("common_conditions", []):
                errors["diabetes_status"] = "وضعیت دیابت را مشخص کنید."
            attrs.update(fasting_glucose=None, hba1c=None)
        elif "none" in attrs.get("common_conditions", []):
            errors["common_conditions"] = "برای دیابت، گزینه هیچ‌کدام را بردارید."
        start, end = attrs.get("smoking_start_date"), attrs.get("smoking_end_date")
        if start and end and end < start:
            errors["smoking_end_date"] = "تاریخ ترک نمی‌تواند قبل از تاریخ شروع باشد."
        if attrs.get("smoking_status") == "never":
            attrs.update(smoking_start_date=None, smoking_end_date=None)
        elif attrs.get("smoking_status") == "current":
            attrs["smoking_end_date"] = None
        if errors:
            raise serializers.ValidationError(errors)
        attrs["has_night_pain"] = attrs["night_pain_frequency"] != "none"
        return attrs


class WOMACSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    supplemental_items = serializers.SerializerMethodField()
    health_score = serializers.SerializerMethodField()

    class Meta:
        model = WOMACResponse
        exclude = ("id", "case")
        read_only_fields = ("version", "scale", "pain_score", "stiffness_score", "function_score", "total_score", "normalized_score", "health_score", "completed_at", "items", "supplemental_items")

    def get_items(self, _obj):
        return WOMAC_ITEMS

    def get_supplemental_items(self, _obj):
        return KNEE_SUPPLEMENTAL_ITEMS

    def get_health_score(self, obj):
        return round(100 - float(obj.normalized_score), 2)

    def validate_responses(self, responses):
        if set(responses) != set(WOMAC_ITEM_IDS):
            raise serializers.ValidationError("پاسخ هر ۲۴ پرسش WOMAC الزامی است.")
        if any(type(value) is not int or not 0 <= value <= 4 for value in responses.values()):
            raise serializers.ValidationError("هر پاسخ WOMAC باید عددی بین صفر تا چهار باشد.")
        return responses

    def validate_supplemental_responses(self, responses):
        if any(item_id not in KNEE_SUPPLEMENTAL_ITEM_IDS for item_id in responses):
            raise serializers.ValidationError("شناسه سؤال تکمیلی معتبر نیست.")
        if any(type(value) is not int or not 0 <= value <= 4 for value in responses.values()):
            raise serializers.ValidationError("هر پاسخ تکمیلی باید عددی بین صفر تا چهار باشد.")
        return responses

    def create(self, validated_data):
        return super().create(self._with_scores(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._with_scores(validated_data))

    @staticmethod
    def _with_scores(validated_data):
        responses = validated_data["responses"]
        pain = sum(responses[item_id] for item_id, _ in WOMAC_ITEMS["pain"])
        stiffness = sum(responses[item_id] for item_id, _ in WOMAC_ITEMS["stiffness"])
        function = sum(responses[item_id] for item_id, _ in WOMAC_ITEMS["function"])
        total = pain + stiffness + function
        return {
            **validated_data,
            "pain_score": pain,
            "stiffness_score": stiffness,
            "function_score": function,
            "total_score": total,
            "normalized_score": round(total / 96 * 100, 2),
        }


class XRayImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = XRayImage
        fields = ("id", "image", "image_url", "view", "purpose", "uploaded_at")
        extra_kwargs = {"image": {"write_only": True}}

    def get_image_url(self, obj):
        request = self.context.get("request")
        path = f"/api/v1/images/{obj.pk}/file/"
        return request.build_absolute_uri(path) if request else path

    def validate_image(self, image):
        allowed = {"image/jpeg", "image/png", "image/webp"}
        if getattr(image, "content_type", None) not in allowed:
            raise serializers.ValidationError("فرمت تصویر باید JPG، PNG یا WebP باشد.")
        if image.size > settings.MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("حجم هر تصویر نباید بیشتر از ۱۲ مگابایت باشد.")
        return image


class AssessmentSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    source_label = serializers.CharField(source="get_source_display", read_only=True)
    verdict_label = serializers.CharField(source="get_verdict_display", read_only=True)
    high_risk_conditions = selection_field(HIGH_RISK)
    compartments = selection_field(COMPARTMENTS)

    class Meta:
        model = Assessment
        fields = ("id", "source", "source_label", "author", "verdict", "verdict_label", "rationale", "clinical_history", "has_lower_back_pain", "has_hip_pain", "kl_grade", "radiographic_oa_confirmed", "risk_optimization", "expectation_notes", "retropatellar_pain", "flexion_degrees", "extension_degrees", "ligament_stability", "limb_alignment", "standing_xray", "compartments", "active_infection", "high_risk_conditions", "educated_about_tka", "realistic_expectations", "model_name", "model_version", "confidence", "created_at", "updated_at")
        read_only_fields = ("source", "author", "model_name", "model_version", "confidence", "created_at", "updated_at")

    def validate_rationale(self, value):
        if len(value.strip()) < 10:
            raise serializers.ValidationError("توضیح تصمیم باید حداقل ۱۰ نویسه باشد.")
        return value.strip()

    def validate(self, attrs):
        check_exclusive(attrs, "high_risk_conditions")
        return attrs


class InsuranceDecisionSerializer(serializers.ModelSerializer):
    reviewer_name = serializers.CharField(source="reviewer.full_name", read_only=True)
    is_mine = serializers.SerializerMethodField()
    decision_label = serializers.CharField(source="get_decision_display", read_only=True)

    class Meta:
        model = InsuranceDecision
        fields = ("id", "reviewer_name", "is_mine", "decision", "decision_label", "rationale", "created_at", "updated_at")
        read_only_fields = ("id", "reviewer_name", "is_mine", "created_at", "updated_at")

    def get_is_mine(self, obj):
        request = self.context.get("request")
        return bool(request and request.user.id == obj.reviewer_id)

    def validate_rationale(self, value):
        if len(value.strip()) < 10:
            raise serializers.ValidationError("توضیح تصمیم بیمه باید حداقل ۱۰ نویسه باشد.")
        return value.strip()


class DoctorPatientSerializer(serializers.ModelSerializer):
    patient = PatientIdentitySerializer(read_only=True)

    class Meta:
        model = DoctorPatient
        fields = ("id", "patient", "created_at")
        read_only_fields = fields


class MedicalCaseListSerializer(serializers.ModelSerializer):
    patient = PatientIdentitySerializer(read_only=True)
    managing_doctor = UserSerializer(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    image_count = serializers.IntegerField(source="images.count", read_only=True)
    has_doctor_assessment = serializers.SerializerMethodField()
    has_ai_assessment = serializers.SerializerMethodField()
    has_insurance_decision = serializers.SerializerMethodField()
    can_edit_intake = serializers.SerializerMethodField()

    class Meta:
        model = MedicalCase
        fields = ("id", "title", "patient", "managing_doctor", "status", "status_label", "image_count", "has_doctor_assessment", "has_ai_assessment", "has_insurance_decision", "can_edit_intake", "submitted_at", "created_at", "updated_at")
        read_only_fields = ("id", "patient", "managing_doctor", "status", "submitted_at", "created_at", "updated_at")

    def get_has_doctor_assessment(self, obj):
        return obj.assessments.filter(source=Assessment.Source.DOCTOR).exists()

    def get_has_ai_assessment(self, obj):
        return obj.assessments.filter(source=Assessment.Source.AI).exists()

    def get_has_insurance_decision(self, obj):
        return hasattr(obj, "insurance_decision")

    def get_can_edit_intake(self, obj):
        request = self.context.get("request")
        if not request or obj.status != MedicalCase.Status.DRAFT:
            return False
        return obj.patient_id == request.user.id or obj.managing_doctor_id == request.user.id


class MedicalCaseDetailSerializer(MedicalCaseListSerializer):
    questionnaire = QuestionnaireSerializer(read_only=True)
    womac = WOMACSerializer(read_only=True)
    images = XRayImageSerializer(many=True, read_only=True)
    assessments = serializers.SerializerMethodField()
    insurance_decision = serializers.SerializerMethodField()
    previsit_scores = serializers.SerializerMethodField()

    class Meta(MedicalCaseListSerializer.Meta):
        fields = MedicalCaseListSerializer.Meta.fields + ("questionnaire_version", "questionnaire", "womac", "images", "assessments", "insurance_decision", "previsit_scores")

    def get_previsit_scores(self, obj):
        request = self.context.get("request")
        if request and request.user.role == User.Role.PATIENT:
            return None
        return previsit_scores(obj)

    def get_assessments(self, obj):
        request = self.context.get("request")
        if request and request.user.role == User.Role.PATIENT:
            return []
        return AssessmentSerializer(obj.assessments.all(), many=True, context=self.context).data

    def get_insurance_decision(self, obj):
        if obj.status != MedicalCase.Status.COMPLETED or not hasattr(obj, "insurance_decision"):
            return None
        return InsuranceDecisionSerializer(obj.insurance_decision, context=self.context).data
