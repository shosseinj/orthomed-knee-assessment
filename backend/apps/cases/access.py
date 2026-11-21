"""One access policy shared by case lists, detail endpoints and image files."""
from django.db.models import Q

from .models import Appointment, MedicalCase


def related_patient_ids(doctor):
    appointments = Appointment.objects.filter(doctor=doctor, patient__isnull=False).exclude(status=Appointment.Status.CANCELLED)
    legacy_cases = MedicalCase.objects.filter(managing_doctor=doctor).exclude(status=MedicalCase.Status.DRAFT)
    return set(appointments.values_list("patient_id", flat=True)) | set(legacy_cases.values_list("patient_id", flat=True))


def can_read_case(doctor, case):
    return case.managing_doctor_id == doctor.id or (
        case.status != MedicalCase.Status.DRAFT and case.patient_id in related_patient_ids(doctor)
    )


def visible_cases(doctor, queryset):
    return queryset.filter(Q(managing_doctor=doctor) | (
        Q(patient_id__in=related_patient_ids(doctor)) & ~Q(status=MedicalCase.Status.DRAFT)
    ))


def intake_is_open(case):
    appointment = getattr(case, "appointment", None)
    return case.status == MedicalCase.Status.DRAFT and (
        appointment is None or appointment.status in (Appointment.Status.SCHEDULED, Appointment.Status.CHECKED_IN)
    )
