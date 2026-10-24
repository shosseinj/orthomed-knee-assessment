from django.conf import settings
from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import PatientIdentitySerializer, UserSerializer
from .models import Assessment, DoctorPatient, InsuranceDecision, MedicalCase, QuestionnaireResponse, WOMACResponse, XRayImage
from .questionnaires import KNEE_SUPPLEMENTAL_ITEM_IDS, KNEE_SUPPLEMENTAL_ITEMS, WOMAC_ITEM_IDS, WOMAC_ITEMS


class QuestionnaireSerializer(serializers.ModelSerializer):
    bmi = serializers.FloatField(read_only=True)
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
        fields = ("id", "image", "image_url", "view", "uploaded_at")
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

    class Meta:
        model = Assessment
        fields = ("id", "source", "source_label", "author", "verdict", "verdict_label", "rationale", "clinical_history", "has_lower_back_pain", "has_hip_pain", "kl_grade", "radiographic_oa_confirmed", "risk_optimization", "expectation_notes", "model_name", "model_version", "confidence", "created_at", "updated_at")
        read_only_fields = ("source", "author", "model_name", "model_version", "confidence", "created_at", "updated_at")

    def validate_rationale(self, value):
        if len(value.strip()) < 10:
            raise serializers.ValidationError("توضیح تصمیم باید حداقل ۱۰ نویسه باشد.")
        return value.strip()


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

    class Meta(MedicalCaseListSerializer.Meta):
        fields = MedicalCaseListSerializer.Meta.fields + ("questionnaire_version", "questionnaire", "womac", "images", "assessments", "insurance_decision")

    def get_assessments(self, obj):
        request = self.context.get("request")
        if request and request.user.role == User.Role.PATIENT:
            return []
        return AssessmentSerializer(obj.assessments.all(), many=True, context=self.context).data

    def get_insurance_decision(self, obj):
        if obj.status != MedicalCase.Status.COMPLETED or not hasattr(obj, "insurance_decision"):
            return None
        return InsuranceDecisionSerializer(obj.insurance_decision, context=self.context).data
