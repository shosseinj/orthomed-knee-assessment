import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from .managers import UserManager
from .validators import validate_birth_date, validate_national_code


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        PATIENT = "patient", "بیمار"
        DOCTOR = "doctor", "پزشک"
        INSURANCE = "insurance", "بیمه"
        ADMIN = "admin", "مدیر سامانه"

    CLINICAL_ROLES = (Role.PATIENT, Role.DOCTOR, Role.INSURANCE)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_number = models.CharField(max_length=11, unique=True)
    national_code = models.CharField(max_length=10, unique=True, null=True, blank=True, validators=[validate_national_code])
    birth_date = models.DateField(null=True, blank=True, validators=[validate_birth_date])
    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.PATIENT)
    medical_council_number = models.CharField(max_length=32, blank=True)
    organization_name = models.CharField(max_length=160, blank=True)
    is_verified = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()
    USERNAME_FIELD = "phone_number"

    class Meta:
        permissions = [("manage_account_verifications", "Can approve and revoke doctor and insurance accounts")]

    @property
    def full_name(self):
        if self.role == self.Role.INSURANCE and self.organization_name:
            return self.organization_name
        return f"{self.first_name} {self.last_name}".strip() or self.phone_number

    def __str__(self):
        return self.full_name

    @property
    def active_role(self):
        return getattr(self, "_session_role", self.role)

    @property
    def active_registration(self):
        if not hasattr(self, "_active_registration"):
            self._active_registration = self.role_registrations.filter(role=self.active_role).first()
        return self._active_registration

    @property
    def active_is_verified(self):
        if self.active_role == "admin":
            return True
        if self.active_role == self.role:
            return self.is_verified
        return bool(self.active_registration and self.active_registration.is_verified)

    @property
    def active_medical_council_number(self):
        if self.active_role != self.Role.DOCTOR:
            return ""
        return self.medical_council_number if self.role == self.Role.DOCTOR else self.active_registration.medical_council_number

    @property
    def active_organization_name(self):
        if self.active_role != self.Role.INSURANCE:
            return ""
        return self.organization_name if self.role == self.Role.INSURANCE else self.active_registration.organization_name

    @property
    def active_full_name(self):
        return self.active_organization_name or f"{self.first_name} {self.last_name}".strip() or self.phone_number


class RoleRegistration(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="role_registrations")
    role = models.CharField(max_length=16, choices=User.Role.choices)
    medical_council_number = models.CharField(max_length=32, blank=True)
    organization_name = models.CharField(max_length=160, blank=True)
    is_verified = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    date_joined = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("user", "role"), name="one_registration_per_user_role")]

    @property
    def full_name(self):
        return self.organization_name if self.role == User.Role.INSURANCE and self.organization_name else f"{self.user.first_name} {self.user.last_name}".strip() or self.user.phone_number


class AISettings(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="ai_settings")
    encrypted_api_key = models.TextField()
    key_last_four = models.CharField(max_length=4)
    updated_at = models.DateTimeField(auto_now=True)


class OTPChallenge(models.Model):
    phone_number = models.CharField(max_length=11, db_index=True)
    code_hash = models.CharField(max_length=128)
    attempts = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @classmethod
    def expiry_time(cls):
        return timezone.now() + timedelta(minutes=2)

    @property
    def is_usable(self):
        return self.consumed_at is None and self.attempts < 5 and self.expires_at > timezone.now()
