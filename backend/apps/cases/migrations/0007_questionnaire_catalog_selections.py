import json

from django.db import migrations, models


def _as_selection_list(value):
    if not value:
        return []
    if isinstance(value, list):
        return value
    try:
        decoded = json.loads(value)
        if isinstance(decoded, list):
            return decoded
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return [part.strip() for part in str(value).replace("\n", "،").split("،") if part.strip()]


def prepare_json_values(apps, _schema_editor):
    questionnaire = apps.get_model("cases", "QuestionnaireResponse")
    for response in questionnaire.objects.only("id", "underlying_conditions", "medications").iterator():
        questionnaire.objects.filter(pk=response.pk).update(
            underlying_conditions=json.dumps(_as_selection_list(response.underlying_conditions), ensure_ascii=False),
            medications=json.dumps(_as_selection_list(response.medications), ensure_ascii=False),
        )


def restore_text_values(apps, _schema_editor):
    questionnaire = apps.get_model("cases", "QuestionnaireResponse")
    for response in questionnaire.objects.only("id", "underlying_conditions", "medications").iterator():
        questionnaire.objects.filter(pk=response.pk).update(
            underlying_conditions="، ".join(_as_selection_list(response.underlying_conditions)),
            medications="، ".join(_as_selection_list(response.medications)),
        )


class Migration(migrations.Migration):
    dependencies = [("cases", "0006_remove_assessment_severity")]

    operations = [
        migrations.RunPython(prepare_json_values, restore_text_values),
        migrations.AlterField(
            model_name="questionnaireresponse",
            name="underlying_conditions",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AlterField(
            model_name="questionnaireresponse",
            name="medications",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
