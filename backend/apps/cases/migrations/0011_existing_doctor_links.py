import uuid
from django.db import migrations


def preserve_links(apps, schema_editor):
    Case = apps.get_model("cases", "MedicalCase")
    Assignment = apps.get_model("cases", "DoctorPatient")
    QR = apps.get_model("cases", "DoctorQR")
    User = apps.get_model("accounts", "User")
    database = schema_editor.connection.alias
    for doctor_id, patient_id in Case.objects.using(database).exclude(managing_doctor_id=None).values_list("managing_doctor_id", "patient_id").distinct():
        Assignment.objects.using(database).get_or_create(doctor_id=doctor_id, patient_id=patient_id)
    doctors = User.objects.using(database).filter(role_registrations__role="doctor", role_registrations__is_verified=True)
    for doctor in doctors.iterator():
        QR.objects.using(database).get_or_create(doctor_id=doctor.pk, defaults={"token": uuid.uuid4()})


class Migration(migrations.Migration):
    dependencies = [("cases", "0010_doctorqr_appointment"), ("accounts", "0007_admin_registration_role")]
    operations = [migrations.RunPython(preserve_links, migrations.RunPython.noop)]
