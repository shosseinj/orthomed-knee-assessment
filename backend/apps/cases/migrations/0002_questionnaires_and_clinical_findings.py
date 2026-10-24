import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("cases", "0001_initial")]
    operations = [
        migrations.AddField(model_name="assessment", name="expectation_notes", field=models.TextField(blank=True)),
        migrations.AddField(model_name="assessment", name="has_hip_pain", field=models.BooleanField(blank=True, null=True)),
        migrations.AddField(model_name="assessment", name="has_lower_back_pain", field=models.BooleanField(blank=True, null=True)),
        migrations.AddField(model_name="assessment", name="kl_grade", field=models.PositiveSmallIntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(4)])),
        migrations.AddField(model_name="assessment", name="radiographic_oa_confirmed", field=models.BooleanField(blank=True, null=True)),
        migrations.AddField(model_name="assessment", name="risk_optimization", field=models.CharField(choices=[("not_assessed", "بررسی نشده"), ("needed", "نیازمند بهینه‌سازی"), ("optimized", "بهینه‌شده")], default="not_assessed", max_length=20)),
        migrations.AddField(model_name="questionnaireresponse", name="age_years", field=models.PositiveSmallIntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(120)])),
        migrations.AddField(model_name="questionnaireresponse", name="conservative_duration_months", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="questionnaireresponse", name="conservative_response", field=models.CharField(choices=[("not_tried", "انجام نشده"), ("none", "بدون پاسخ"), ("partial", "پاسخ نسبی"), ("good", "پاسخ مناسب")], default="not_tried", max_length=16)),
        migrations.AddField(model_name="questionnaireresponse", name="conservative_treatment_rounds", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="questionnaireresponse", name="daily_life_impact", field=models.CharField(choices=[("none", "بدون اختلال"), ("mild", "کم"), ("moderate", "متوسط"), ("severe", "شدید")], default="none", max_length=16)),
        migrations.AddField(model_name="questionnaireresponse", name="diabetes_status", field=models.CharField(choices=[("none", "ندارد"), ("controlled", "کنترل‌شده"), ("uncontrolled", "کنترل‌نشده"), ("unknown", "نامشخص")], default="none", max_length=20)),
        migrations.AddField(model_name="questionnaireresponse", name="gender", field=models.CharField(blank=True, choices=[("female", "زن"), ("male", "مرد"), ("other", "سایر")], max_length=16)),
        migrations.AddField(model_name="questionnaireresponse", name="had_intra_articular_injection", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="questionnaireresponse", name="height_cm", field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
        migrations.AddField(model_name="questionnaireresponse", name="injection_rounds", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="questionnaireresponse", name="injection_types", field=models.JSONField(blank=True, default=list)),
        migrations.AddField(model_name="questionnaireresponse", name="medications", field=models.TextField(blank=True)),
        migrations.AddField(model_name="questionnaireresponse", name="smoking_status", field=models.CharField(choices=[("never", "هرگز"), ("former", "قبلاً"), ("current", "در حال حاضر")], default="never", max_length=16)),
        migrations.AddField(model_name="questionnaireresponse", name="underlying_conditions", field=models.TextField(blank=True)),
        migrations.AddField(model_name="questionnaireresponse", name="weight_kg", field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
        migrations.CreateModel(
            name="WOMACResponse",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("version", models.CharField(default="3.1-provisional-fa", max_length=16)),
                ("scale", models.CharField(default="likert_0_4", max_length=16)),
                ("responses", models.JSONField(default=dict)),
                ("pain_score", models.PositiveSmallIntegerField(default=0)),
                ("stiffness_score", models.PositiveSmallIntegerField(default=0)),
                ("function_score", models.PositiveSmallIntegerField(default=0)),
                ("total_score", models.PositiveSmallIntegerField(default=0)),
                ("normalized_score", models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ("completed_at", models.DateTimeField(auto_now=True)),
                ("case", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="womac", to="cases.medicalcase")),
            ],
        ),
    ]
