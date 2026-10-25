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
