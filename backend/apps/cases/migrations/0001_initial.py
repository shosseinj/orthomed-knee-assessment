import uuid
import apps.cases.models
import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name="MedicalCase", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("status", models.CharField(choices=[("draft", "پیش‌نویس"), ("submitted", "در انتظار بررسی"), ("under_review", "در حال بررسی"), ("completed", "تکمیل‌شده")], db_index=True, default="draft", max_length=20)),
            ("title", models.CharField(default="ارزیابی جراحی زانو", max_length=160)),
            ("questionnaire_version", models.CharField(default="1.0", max_length=16)),
            ("submitted_at", models.DateTimeField(blank=True, null=True)), ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("patient", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="patient_cases", to=settings.AUTH_USER_MODEL)),
        ], options={"ordering": ("-created_at",)}),
        migrations.CreateModel(name="QuestionnaireResponse", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("pain_level", models.PositiveSmallIntegerField(validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(10)])),
            ("pain_duration_months", models.PositiveIntegerField()),
            ("mobility_limit", models.CharField(choices=[("none", "بدون محدودیت"), ("mild", "کم"), ("moderate", "متوسط"), ("severe", "شدید")], max_length=24)),
            ("previous_treatments", models.JSONField(blank=True, default=list)), ("has_night_pain", models.BooleanField(default=False)), ("uses_walking_aid", models.BooleanField(default=False)),
            ("additional_notes", models.TextField(blank=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("case", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="questionnaire", to="cases.medicalcase")),
        ]),
        migrations.CreateModel(name="XRayImage", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("image", models.ImageField(upload_to=apps.cases.models.xray_upload_path)),
            ("view", models.CharField(choices=[("ap", "رخ (AP)"), ("lateral", "نیم‌رخ"), ("skyline", "کشکک"), ("other", "سایر")], default="other", max_length=16)), ("uploaded_at", models.DateTimeField(auto_now_add=True)),
            ("case", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="images", to="cases.medicalcase")),
        ]),
        migrations.CreateModel(name="Assessment", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("source", models.CharField(choices=[("doctor", "پزشک"), ("ai", "هوش مصنوعی")], max_length=12)),
            ("verdict", models.CharField(choices=[("surgery", "نیاز به جراحی"), ("no_surgery", "عدم نیاز به جراحی"), ("inconclusive", "نیازمند بررسی بیشتر")], max_length=20)),
            ("severity", models.PositiveSmallIntegerField(validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(4)])),
            ("rationale", models.TextField()), ("clinical_history", models.TextField(blank=True)), ("model_name", models.CharField(blank=True, max_length=100)), ("model_version", models.CharField(blank=True, max_length=100)), ("confidence", models.DecimalField(blank=True, decimal_places=3, max_digits=4, null=True)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("author", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="assessments", to=settings.AUTH_USER_MODEL)),
            ("case", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="assessments", to="cases.medicalcase")),
        ]),
        migrations.AddConstraint(model_name="assessment", constraint=models.UniqueConstraint(fields=("case", "source"), name="one_assessment_per_source")),
    ]
