from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("cases", "0005_doctorpatient_medicalcase_managing_doctor"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="assessment",
            name="severity",
        ),
    ]
