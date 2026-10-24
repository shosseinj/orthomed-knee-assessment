from django.db import migrations, models

import apps.accounts.validators


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_user_organization_name")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="national_code",
            field=models.CharField(blank=True, max_length=10, null=True, unique=True, validators=[apps.accounts.validators.validate_national_code]),
        ),
        migrations.AddField(
            model_name="user",
            name="birth_date",
            field=models.DateField(blank=True, null=True, validators=[apps.accounts.validators.validate_birth_date]),
        ),
    ]
