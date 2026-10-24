from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("cases", "0002_questionnaires_and_clinical_findings")]
    operations = [
        migrations.AddField(
            model_name="womacresponse",
            name="supplemental_responses",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
