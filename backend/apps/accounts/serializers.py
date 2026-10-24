import re

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .services import issue_otp, verify_otp
from .validators import normalize_national_code, validate_birth_date


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if digits.startswith("98"):
        digits = "0" + digits[2:]
    if not re.fullmatch(r"09\d{9}", digits):
        raise serializers.ValidationError("شماره موبایل معتبر نیست.")
    return digits


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "phone_number", "first_name", "last_name", "full_name", "role", "medical_council_number", "organization_name", "is_verified")


class PatientIdentitySerializer(UserSerializer):
    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ("national_code", "birth_date")


class AccountSelfSerializer(PatientIdentitySerializer):
    audit_access = serializers.SerializerMethodField()

    class Meta(PatientIdentitySerializer.Meta):
        fields = PatientIdentitySerializer.Meta.fields + ("audit_access",)

    def get_audit_access(self, obj):
        return bool(settings.ACCESS_AUDIT_PHONE_NUMBER and obj.phone_number == settings.ACCESS_AUDIT_PHONE_NUMBER)


class PatientProfileSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(max_length=80, trim_whitespace=True, allow_blank=False)
    last_name = serializers.CharField(max_length=100, trim_whitespace=True, allow_blank=False)
    birth_date = serializers.DateField()

    class Meta:
        model = User
        fields = ("first_name", "last_name", "birth_date")

    def validate_birth_date(self, value):
        try:
            return validate_birth_date(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc


class OTPRequestSerializer(serializers.Serializer):
    phone_number = serializers.CharField()

    def validate_phone_number(self, value):
        return normalize_phone(value)

    def save(self):
        return issue_otp(self.validated_data["phone_number"])


class PanelAccessSerializer(serializers.Serializer):
    path = serializers.RegexField(r"^/(?:dashboard|profile|cases/(?:new|[0-9a-fA-F-]{36}))/?$", max_length=80)
    client_timezone = serializers.CharField(max_length=64, required=False, allow_blank=True)


class OTPVerifySerializer(serializers.Serializer):
    phone_number = serializers.CharField()
    code = serializers.RegexField(r"^\d{5}$")
    first_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    national_code = serializers.CharField(required=False, allow_blank=True)
    birth_date = serializers.DateField(required=False)
    role = serializers.ChoiceField(choices=(User.Role.PATIENT, User.Role.DOCTOR, User.Role.INSURANCE), required=False)
    medical_council_number = serializers.CharField(max_length=32, required=False, allow_blank=True)
    organization_name = serializers.CharField(max_length=160, required=False, allow_blank=True)

    def validate_phone_number(self, value):
        return normalize_phone(value)

    def validate_national_code(self, value):
        if not value.strip():
            return ""
        try:
            return normalize_national_code(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc

    def validate_birth_date(self, value):
        try:
            return validate_birth_date(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc

    def validate(self, attrs):
        if not User.objects.filter(phone_number=attrs["phone_number"]).exists():
            role = attrs.get("role", User.Role.PATIENT)
            if not attrs.get("first_name", "").strip() or not attrs.get("last_name", "").strip():
                raise serializers.ValidationError("نام و نام خانوادگی برای ثبت‌نام الزامی است.")
            if not attrs.get("national_code"):
                raise serializers.ValidationError({"national_code": "کد ملی برای ثبت‌نام الزامی است."})
            if "birth_date" not in attrs:
                raise serializers.ValidationError({"birth_date": "تاریخ تولد برای ثبت‌نام الزامی است."})
            if User.objects.filter(national_code=attrs["national_code"]).exists():
                raise serializers.ValidationError({"national_code": "این کد ملی قبلاً ثبت شده است."})
            if role == User.Role.DOCTOR and not attrs.get("medical_council_number", "").strip():
                raise serializers.ValidationError({"medical_council_number": "شماره نظام پزشکی الزامی است."})
            if role == User.Role.INSURANCE and not attrs.get("organization_name", "").strip():
                raise serializers.ValidationError({"organization_name": "نام شرکت بیمه الزامی است."})
        if not verify_otp(attrs["phone_number"], attrs["code"]):
            raise serializers.ValidationError({"code": "کد واردشده نامعتبر یا منقضی است."})
        return attrs

    def save(self):
        phone = self.validated_data["phone_number"]
        user, created = User.objects.get_or_create(phone_number=phone)
        if created:
            user.first_name = self.validated_data.get("first_name", "")
            user.last_name = self.validated_data.get("last_name", "")
            user.national_code = self.validated_data["national_code"]
            user.birth_date = self.validated_data["birth_date"]
            user.role = self.validated_data.get("role", User.Role.PATIENT)
            user.medical_council_number = self.validated_data.get("medical_council_number", "")
            user.organization_name = self.validated_data.get("organization_name", "")
            user.is_verified = user.role == User.Role.PATIENT
            user.save()
        refresh = RefreshToken.for_user(user)
        return {"access": str(refresh.access_token), "refresh": str(refresh), "user": AccountSelfSerializer(user).data}
