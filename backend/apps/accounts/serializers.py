import re

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .services import issue_otp, verify_otp
from .validators import normalize_national_code, validate_birth_date
from .permissions import can_manage_accounts


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
    can_manage_accounts = serializers.SerializerMethodField()

    class Meta(PatientIdentitySerializer.Meta):
        fields = PatientIdentitySerializer.Meta.fields + ("audit_access", "can_manage_accounts")

    def get_can_manage_accounts(self, obj):
        return can_manage_accounts(obj)

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
    path = serializers.RegexField(r"^/(?:dashboard|profile|settings|management|cases/(?:new|[0-9a-fA-F-]{36}))/?$", max_length=80)
    client_timezone = serializers.CharField(max_length=64, required=False, allow_blank=True)


class AISettingsSerializer(serializers.Serializer):
    openai_api_key = serializers.CharField(write_only=True, min_length=20, max_length=512, trim_whitespace=True)

    def validate_openai_api_key(self, value):
        if not value.startswith("sk-") or not value.isascii() or any(char.isspace() for char in value):
            raise serializers.ValidationError("کلید OpenAI معتبر نیست؛ کلید باید با sk- شروع شود و فاصله نداشته باشد.")
        return value


class ManagedAccountSerializer(PatientIdentitySerializer):
    class Meta(PatientIdentitySerializer.Meta):
        fields = PatientIdentitySerializer.Meta.fields + ("is_active", "date_joined")
        read_only_fields = fields


class AccountReviewSerializer(serializers.Serializer):
    is_verified = serializers.BooleanField()

    def validate(self, attrs):
        if set(self.initial_data) - {"is_verified"}:
            raise serializers.ValidationError("فقط وضعیت تأیید حساب از این بخش قابل تغییر است.")
        return attrs


class AccountListQuerySerializer(serializers.Serializer):
    q = serializers.CharField(max_length=120, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=("doctor", "insurance", ""), required=False)
    status = serializers.ChoiceField(choices=("pending", "verified", "inactive", "all"), required=False)


class OTPVerifySerializer(serializers.Serializer):
    phone_number = serializers.CharField()
    code = serializers.RegexField(r"^\d{5}$")

    def validate_phone_number(self, value):
        return normalize_phone(value)

    def validate(self, attrs):
        if not verify_otp(attrs["phone_number"], attrs["code"]):
            raise serializers.ValidationError({"code": "کد واردشده نامعتبر یا منقضی است."})
        return attrs

    def save(self):
        phone = self.validated_data["phone_number"]
        user = User.objects.filter(phone_number=phone).first()
        if user is None:
            return {
                "registration_required": True,
                "registration_token": signing.dumps({"phone_number": phone}, salt="accounts.phone-registration"),
            }
        return {"registration_required": False, **login_result(user)}


def login_result(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": AccountSelfSerializer(user).data}


class RegistrationSerializer(serializers.Serializer):
    registration_token = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=100)
    national_code = serializers.CharField()
    birth_date = serializers.DateField()
    role = serializers.ChoiceField(choices=(User.Role.PATIENT, User.Role.DOCTOR, User.Role.INSURANCE), default=User.Role.PATIENT)
    medical_council_number = serializers.CharField(max_length=32, required=False, allow_blank=True)
    organization_name = serializers.CharField(max_length=160, required=False, allow_blank=True)

    def validate_registration_token(self, value):
        try:
            payload = signing.loads(value, salt="accounts.phone-registration", max_age=15 * 60)
            self.phone_number = normalize_phone(payload["phone_number"])
        except (signing.BadSignature, KeyError, TypeError):
            raise serializers.ValidationError("اعتبار تأیید شماره موبایل پایان یافته است. دوباره کد بگیرید.")
        return value

    def validate_national_code(self, value):
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
        attrs["phone_number"] = self.phone_number
        if User.objects.filter(phone_number=self.phone_number).exists():
            raise serializers.ValidationError({"registration_token": "این شماره قبلاً ثبت شده است. دوباره کد ورود بگیرید."})
        if User.objects.filter(national_code=attrs["national_code"]).exists():
            raise serializers.ValidationError({"national_code": "این کد ملی قبلاً ثبت شده است."})
        if attrs["role"] == User.Role.DOCTOR and not attrs.get("medical_council_number", "").strip():
            raise serializers.ValidationError({"medical_council_number": "شماره نظام پزشکی الزامی است."})
        if attrs["role"] == User.Role.INSURANCE and not attrs.get("organization_name", "").strip():
            raise serializers.ValidationError({"organization_name": "نام شرکت بیمه الزامی است."})
        return attrs

    def save(self):
        fields = {key: value for key, value in self.validated_data.items() if key != "registration_token"}
        try:
            with transaction.atomic():
                user = User.objects.create_user(**fields, is_verified=fields["role"] == User.Role.PATIENT)
        except IntegrityError:
            raise serializers.ValidationError("شماره موبایل یا کد ملی قبلاً ثبت شده است.") from None
        return login_result(user)
