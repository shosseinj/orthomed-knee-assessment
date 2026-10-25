import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class MedicalCase(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        SUBMITTED = "submitted", "در انتظار بررسی"
        UNDER_REVIEW = "under_review", "در انتظار تصمیم بیمه"
        COMPLETED = "completed", "نهایی‌شده"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="patient_cases")
    managing_doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="managed_cases",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    title = models.CharField(max_length=160, default="ارزیابی جراحی زانو")
    questionnaire_version = models.CharField(max_length=16, default="1.0")
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)

    def submit(self):
        if not self.images.filter(purpose="xray").exists() or not hasattr(self, "questionnaire") or not hasattr(self, "womac"):
            raise ValueError("برای ثبت پرونده، شرح حال، پرسش‌نامه WOMAC و تصویر الزامی است.")
        self.status = self.Status.SUBMITTED
        self.submitted_at = timezone.now()
        self.save(update_fields=["status", "submitted_at", "updated_at"])


class DoctorPatient(models.Model):
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="patient_assignments")
    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="doctor_assignments")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("patient__last_name", "patient__first_name", "-created_at")
        constraints = [
            models.UniqueConstraint(fields=("doctor", "patient"), name="one_patient_assignment_per_doctor"),
        ]

    def __str__(self):
        return f"{self.doctor} → {self.patient}"


class QuestionnaireResponse(models.Model):
    case = models.OneToOneField(MedicalCase, on_delete=models.CASCADE, related_name="questionnaire")
    age_years = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(120)])
    gender = models.CharField(max_length=16, choices=(("female", "زن"), ("male", "مرد"), ("other", "سایر")), blank=True)
    underlying_conditions = models.JSONField(default=list, blank=True)
    medications = models.JSONField(default=list, blank=True)
    height_cm = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    pain_level = models.PositiveSmallIntegerField(validators=[MinValueValidator(0), MaxValueValidator(10)])
    pain_duration_months = models.PositiveIntegerField()
    mobility_limit = models.CharField(max_length=24, choices=(("none", "بدون محدودیت"), ("mild", "کم"), ("moderate", "متوسط"), ("severe", "شدید")))
    previous_treatments = models.JSONField(default=list, blank=True)
    conservative_treatment_rounds = models.PositiveSmallIntegerField(default=0)
    conservative_duration_months = models.PositiveSmallIntegerField(default=0)
    conservative_response = models.CharField(max_length=16, choices=(("not_tried", "انجام نشده"), ("none", "بدون پاسخ"), ("partial", "پاسخ نسبی"), ("good", "پاسخ مناسب")), default="not_tried")
    had_intra_articular_injection = models.BooleanField(default=False)
    injection_rounds = models.PositiveSmallIntegerField(default=0)
    injection_types = models.JSONField(default=list, blank=True)
    daily_life_impact = models.CharField(max_length=16, choices=(("none", "بدون اختلال"), ("mild", "کم"), ("moderate", "متوسط"), ("severe", "شدید")), default="none")
    smoking_status = models.CharField(max_length=16, choices=(("never", "هرگز"), ("former", "قبلاً"), ("current", "در حال حاضر")), default="never")
    diabetes_status = models.CharField(max_length=20, choices=(("none", "ندارد"), ("controlled", "کنترل‌شده"), ("uncontrolled", "کنترل‌نشده"), ("unknown", "نامشخص")), default="none")
    has_night_pain = models.BooleanField(default=False)
    uses_walking_aid = models.BooleanField(default=False)
    additional_notes = models.TextField(blank=True)
    intake_version = models.CharField(max_length=16, blank=True)
    affected_knee = models.CharField(max_length=8, blank=True, choices=(("right", "راست"), ("left", "چپ"), ("both", "هر دو")))
    worst_pain_month = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(10)])
    walking_pain = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(10)])
    night_pain_frequency = models.CharField(max_length=16, blank=True, choices=(("none", "ندارم"), ("sometimes", "گاهی"), ("often", "اغلب")))
    walking_capacity = models.CharField(max_length=16, blank=True, choices=(("under_2", "کمتر از ۲ دقیقه"), ("2_to_5", "۲ تا ۵ دقیقه"), ("5_to_10", "۵ تا ۱۰ دقیقه"), ("over_10", "بیشتر از ۱۰ دقیقه")))
    stair_difficulty = models.CharField(max_length=16, blank=True, choices=(("none", "بدون مشکل"), ("pain", "با درد"), ("support", "فقط با کمک/نرده"), ("unable", "نمی‌توانم")))
    daily_activity_pain = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(10)])
    sleep_disruption = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(10)])
    physiotherapy_sessions = models.CharField(max_length=16, blank=True, choices=(("none", "انجام نداده‌ام"), ("under_10", "کمتر از ۱۰ جلسه"), ("10_plus", "۱۰ جلسه یا بیشتر")))
    physiotherapy_effect = models.CharField(max_length=16, blank=True, choices=(("not_tried", "انجام نداده‌ام"), ("none", "بی‌اثر"), ("partial", "کمی بهتر"), ("good", "خوب")))
    injection_other = models.CharField(max_length=240, blank=True)
    injection_effect = models.CharField(max_length=16, blank=True, choices=(("good", "بهبود قابل توجه"), ("temporary", "موقت"), ("none", "بدون پاسخ"), ("not_tried", "تزریق نداشته‌ام")))
    injection_last_time = models.CharField(max_length=16, blank=True, choices=(("under_1", "کمتر از ۱ ماه پیش"), ("1_to_3", "۱ تا ۳ ماه پیش"), ("3_to_6", "۳ تا ۶ ماه پیش"), ("over_6", "بیشتر از ۶ ماه پیش"), ("unknown", "یادم نیست")))
    takes_painkillers = models.BooleanField(null=True, blank=True)
    painkillers = models.JSONField(default=list, blank=True)
    painkiller_other = models.CharField(max_length=240, blank=True)
    analgesic_effect = models.CharField(max_length=16, blank=True, choices=(("none", "اصلاً"), ("low", "کم"), ("moderate", "متوسط"), ("high", "زیاد")))
    weight_loss_attempted = models.BooleanField(null=True, blank=True)
    weight_loss_effect = models.CharField(max_length=16, blank=True, choices=(("none", "خیر"), ("partial", "تا حدودی"), ("good", "بله به مقدار زیاد")))
    common_conditions = models.JSONField(default=list, blank=True)
    condition_notes = models.TextField(blank=True)
    fasting_glucose = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(2000)])
    hba1c = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(30)])
    smoking_start_date = models.DateField(null=True, blank=True)
    smoking_end_date = models.DateField(null=True, blank=True)
    red_flags = models.JSONField(default=list, blank=True)
    red_flags_other = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def bmi(self):
        if not self.height_cm or not self.weight_kg:
            return None
        height_m = float(self.height_cm) / 100
        return round(float(self.weight_kg) / (height_m * height_m), 1) if height_m else None


class WOMACResponse(models.Model):
    case = models.OneToOneField(MedicalCase, on_delete=models.CASCADE, related_name="womac")
    version = models.CharField(max_length=16, default="3.1-provisional-fa")
    scale = models.CharField(max_length=16, default="likert_0_4")
    responses = models.JSONField(default=dict)
    supplemental_responses = models.JSONField(default=dict, blank=True)
    pain_score = models.PositiveSmallIntegerField(default=0)
    stiffness_score = models.PositiveSmallIntegerField(default=0)
    function_score = models.PositiveSmallIntegerField(default=0)
    total_score = models.PositiveSmallIntegerField(default=0)
    normalized_score = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    completed_at = models.DateTimeField(auto_now=True)


def xray_upload_path(instance, filename):
    return f"cases/{instance.case_id}/xrays/{uuid.uuid4()}-{filename}"


class XRayImage(models.Model):
    class View(models.TextChoices):
        AP = "ap", "رخ (AP)"
        LATERAL = "lateral", "نیم‌رخ"
        SKYLINE = "skyline", "کشکک"
        OTHER = "other", "سایر"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(MedicalCase, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to=xray_upload_path)
    view = models.CharField(max_length=16, choices=View.choices, default=View.OTHER)
    purpose = models.CharField(max_length=8, default="xray", choices=(("xray", "رادیولوژی"), ("lab", "آزمایش")))
    uploaded_at = models.DateTimeField(auto_now_add=True)


class Assessment(models.Model):
    class Source(models.TextChoices):
        DOCTOR = "doctor", "پزشک"
        AI = "ai", "هوش مصنوعی"

    class Verdict(models.TextChoices):
        SURGERY = "surgery", "نیاز به جراحی"
        NO_SURGERY = "no_surgery", "عدم نیاز به جراحی"
        INCONCLUSIVE = "inconclusive", "نیازمند بررسی بیشتر"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(MedicalCase, on_delete=models.CASCADE, related_name="assessments")
    source = models.CharField(max_length=12, choices=Source.choices)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="assessments")
    verdict = models.CharField(max_length=20, choices=Verdict.choices)
    rationale = models.TextField()
    clinical_history = models.TextField(blank=True)
    has_lower_back_pain = models.BooleanField(null=True, blank=True)
    has_hip_pain = models.BooleanField(null=True, blank=True)
    kl_grade = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(0), MaxValueValidator(4)])
    radiographic_oa_confirmed = models.BooleanField(null=True, blank=True)
    risk_optimization = models.CharField(max_length=20, choices=(("not_assessed", "بررسی نشده"), ("needed", "نیازمند بهینه‌سازی"), ("optimized", "بهینه‌شده")), default="not_assessed")
    expectation_notes = models.TextField(blank=True)
    retropatellar_pain = models.BooleanField(null=True, blank=True)
    flexion_degrees = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(180)])
    extension_degrees = models.SmallIntegerField(null=True, blank=True, validators=[MinValueValidator(-90), MaxValueValidator(90)])
    ligament_stability = models.CharField(max_length=16, blank=True, choices=(("stable", "پایدار"), ("unstable", "ناپایدار")))
    limb_alignment = models.CharField(max_length=16, blank=True, choices=(("normal", "نرمال"), ("varus", "واروس"), ("valgus", "والگوس")))
    standing_xray = models.BooleanField(null=True, blank=True)
    compartments = models.JSONField(default=list, blank=True)
    active_infection = models.BooleanField(null=True, blank=True)
    high_risk_conditions = models.JSONField(default=list, blank=True)
    educated_about_tka = models.BooleanField(null=True, blank=True)
    realistic_expectations = models.BooleanField(null=True, blank=True)
    model_name = models.CharField(max_length=100, blank=True)
    model_version = models.CharField(max_length=100, blank=True)
    confidence = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("case", "source"), name="one_assessment_per_source")]


class InsuranceDecision(models.Model):
    class Decision(models.TextChoices):
        APPROVED = "approved", "تأیید جراحی"
        REJECTED = "rejected", "عدم تأیید جراحی"

    case = models.OneToOneField(MedicalCase, on_delete=models.CASCADE, related_name="insurance_decision")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="insurance_decisions")
    decision = models.CharField(max_length=16, choices=Decision.choices)
    rationale = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
