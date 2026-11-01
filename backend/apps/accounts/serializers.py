import re

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.contrib.auth.hashers import check_password
from django.contrib.auth.models import Permission
from django.db import IntegrityError, transaction
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import RoleRegistration, User
from .services import issue_otp, verify_otp
from .validators import normalize_national_code, validate_birth_date
from .permissions import can_manage_accounts, has_management_access


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


class CasePatientSerializer(PatientIdentitySerializer):
    def to_representation(self, instance):
        data = super().to_representation(instance)
        registration = instance.role_registrations.filter(role="patient").first()
        data.update(role="patient", medical_council_number="", organization_name="",
                    is_verified=registration.is_verified if registration else False,
                    full_name=f"{instance.first_name} {instance.last_name}".strip() or instance.phone_number)
        return data


class DoctorIdentitySerializer(UserSerializer):
    def to_representation(self, instance):
        data = super().to_representation(instance)
        registration = instance.role_registrations.filter(role="doctor").first()
        data.update(role="doctor", organization_name="",
                    medical_council_number=registration.medical_council_number if registration else "",
                    is_verified=registration.is_verified if registration else False,
                    full_name=f"{instance.first_name} {instance.last_name}".strip() or instance.phone_number)
        return data


class AccountSelfSerializer(PatientIdentitySerializer):
    role = serializers.CharField(source="active_role", read_only=True)
    is_verified = serializers.BooleanField(source="active_is_verified", read_only=True)
    full_name = serializers.CharField(source="active_full_name", read_only=True)
    medical_council_number = serializers.CharField(source="active_medical_council_number", read_only=True)
    organization_name = serializers.CharField(source="active_organization_name", read_only=True)
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


class ManagedAccountSerializer(serializers.ModelSerializer):
    phone_number = serializers.CharField(source="user.phone_number", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    full_name = serializers.CharField(read_only=True)
    national_code = serializers.CharField(source="user.national_code", read_only=True, allow_null=True)
    birth_date = serializers.DateField(source="user.birth_date", read_only=True, allow_null=True)
    is_active = serializers.SerializerMethodField()

    def get_is_active(self, obj):
        return obj.is_active and obj.user.is_active

    class Meta:
        model = RoleRegistration
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
    entry_role = serializers.ChoiceField(choices=User.Role.values, required=False)

    def validate_phone_number(self, value):
        return normalize_phone(value)

    def validate(self, attrs):
        if not verify_otp(attrs["phone_number"], attrs["code"]):
            raise serializers.ValidationError({"code": "کد واردشده نامعتبر یا منقضی است."})
        return attrs

    def save(self):
        phone = self.validated_data["phone_number"]
        entry_role = self.validated_data.get("entry_role")
        user = User.objects.filter(phone_number=phone).first()
        admin_signup = entry_role == User.Role.ADMIN and not has_management_access(user)
        if admin_signup and not settings.ADMIN_REGISTRATION_PASSWORD_HASH:
            raise serializers.ValidationError({"entry_role": "ورود ادمین فقط برای حساب دارای دسترسی مدیر سامانه امکان‌پذیر است. ثبت‌نام عمومی ادمین مجاز نیست."})
        if user and not user.is_active:
            raise serializers.ValidationError({"entry_role": "حساب کاربری غیرفعال است."})
        registration = user.role_registrations.filter(role=entry_role).first() if user and entry_role else None
        if admin_signup and registration:
            raise serializers.ValidationError({"entry_role": "دسترسی به نقش انتخاب‌شده فعال نیست."})
        if user is None or admin_signup or (entry_role and entry_role != "admin" and registration is None):
            registration = {"phone_number": phone}
            if entry_role:
                registration["role"] = entry_role
            if user:
                registration["user_id"] = str(user.pk)
            result = {
                "registration_required": True,
                "registration_token": signing.dumps(registration, salt="accounts.phone-registration"),
            }
            if user:
                result["registration_profile"] = {
                    "first_name": user.first_name, "last_name": user.last_name,
                    "national_code": user.national_code, "birth_date": user.birth_date,
                }
            return result
        if registration and not registration.is_active:
            raise serializers.ValidationError({"entry_role": "دسترسی به نقش انتخاب‌شده فعال نیست."})
        return {"registration_required": False, **login_result(user, entry_role)}


def login_result(user, role=None):
    role = role or ("admin" if has_management_access(user) else user.role)
    user._session_role = role
    user.__dict__.pop("_active_registration", None)
    refresh = RefreshToken.for_user(user)
    refresh["active_role"] = role
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": AccountSelfSerializer(user).data}


class RegistrationSerializer(serializers.Serializer):
    registration_token = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=100)
    national_code = serializers.CharField()
    birth_date = serializers.DateField()
    role = serializers.ChoiceField(choices=User.Role.choices, default=User.Role.PATIENT)
    admin_password = serializers.CharField(write_only=True, required=False, max_length=128, trim_whitespace=False)
    medical_council_number = serializers.CharField(max_length=32, required=False, allow_blank=True)
    organization_name = serializers.CharField(max_length=160, required=False, allow_blank=True)

    def validate_registration_token(self, value):
        try:
            payload = signing.loads(value, salt="accounts.phone-registration", max_age=15 * 60)
            self.phone_number = normalize_phone(payload["phone_number"])
            self.entry_role = payload.get("role")
            self.existing_user_id = payload.get("user_id")
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
        if self.entry_role and attrs["role"] != self.entry_role:
            raise serializers.ValidationError({"role": "نوع حساب باید با نوع ورود انتخاب‌شده مطابقت داشته باشد."})
        if attrs["role"] == User.Role.ADMIN:
            if self.entry_role != User.Role.ADMIN:
                raise serializers.ValidationError({"role": "نوع حساب باید با نوع ورود انتخاب‌شده مطابقت داشته باشد."})
            password_hash = settings.ADMIN_REGISTRATION_PASSWORD_HASH
            if not password_hash or not check_password(attrs.get("admin_password", ""), password_hash):
                raise serializers.ValidationError({"admin_password": "رمز ثبت‌نام ادمین نامعتبر است."})
        self.existing_user = User.objects.filter(phone_number=self.phone_number).first()
        if self.existing_user and (not self.existing_user_id or str(self.existing_user.pk) != self.existing_user_id):
            raise serializers.ValidationError({"registration_token": "این شماره قبلاً ثبت شده است. دوباره کد ورود بگیرید."})
        if self.existing_user_id and not self.existing_user:
            raise serializers.ValidationError({"registration_token": "اعتبار تأیید شماره موبایل پایان یافته است. دوباره کد بگیرید."})
        if self.existing_user and self.existing_user.role_registrations.filter(role=attrs["role"]).exists():
            raise serializers.ValidationError({"registration_token": "قبلاً برای این نقش ثبت‌نام کرده‌اید. دوباره کد ورود بگیرید."})
        if self.existing_user and not self.existing_user.is_active:
            raise serializers.ValidationError({"registration_token": "حساب کاربری غیرفعال است."})
        duplicates = User.objects.filter(national_code=attrs["national_code"])
        if self.existing_user:
            duplicates = duplicates.exclude(pk=self.existing_user.pk)
            if self.existing_user.national_code and self.existing_user.national_code != attrs["national_code"]:
                raise serializers.ValidationError({"national_code": "کد ملی باید با اطلاعات هویت ثبت‌شده شما مطابقت داشته باشد."})
            for field in ("first_name", "last_name", "birth_date"):
                existing_value = getattr(self.existing_user, field)
                if existing_value and existing_value != attrs[field]:
                    raise serializers.ValidationError({field: "مشخصات هویتی باید با اطلاعات ثبت‌شده شما مطابقت داشته باشد."})
        if duplicates.exists():
            raise serializers.ValidationError({"national_code": "این کد ملی قبلاً ثبت شده است."})
        if attrs["role"] == User.Role.DOCTOR and not attrs.get("medical_council_number", "").strip():
            raise serializers.ValidationError({"medical_council_number": "شماره نظام پزشکی الزامی است."})
        if attrs["role"] == User.Role.INSURANCE and not attrs.get("organization_name", "").strip():
            raise serializers.ValidationError({"organization_name": "نام شرکت بیمه الزامی است."})
        return attrs

    def save(self):
        fields = {key: value for key, value in self.validated_data.items() if key not in ("registration_token", "admin_password")}
        is_admin = fields["role"] == User.Role.ADMIN
        verified = fields["role"] in (User.Role.PATIENT, User.Role.ADMIN)
        try:
            with transaction.atomic():
                if self.existing_user:
                    user = User.objects.select_for_update().filter(pk=self.existing_user.pk, is_active=True).first()
                    if not user:
                        raise serializers.ValidationError({"registration_token": "حساب کاربری غیرفعال است."})
                    # Do not overwrite the existing identity or another role's approval.
                    missing = []
                    for field in ("first_name", "last_name", "national_code", "birth_date"):
                        if not getattr(user, field):
                            setattr(user, field, fields[field])
                            missing.append(field)
                    if missing:
                        user.save(update_fields=missing)
                    RoleRegistration.objects.create(
                        user=user, role=fields["role"], is_verified=verified,
                        medical_council_number=fields.get("medical_council_number", ""),
                        organization_name=fields.get("organization_name", ""),
                    )
                else:
                    user = User.objects.create_user(**fields, is_verified=verified)
                if is_admin:
                    user.is_staff = True
                    user.set_password(self.validated_data["admin_password"])
                    user.save(update_fields=["is_staff", "password"])
                    user.user_permissions.add(Permission.objects.get(
                        content_type__app_label="accounts", codename="manage_account_verifications",
                    ))
                    for cache_name in ("_perm_cache", "_user_perm_cache", "_group_perm_cache"):
                        user.__dict__.pop(cache_name, None)
        except IntegrityError:
            raise serializers.ValidationError("شماره موبایل یا کد ملی قبلاً ثبت شده است.") from None
        return login_result(user, fields["role"])
