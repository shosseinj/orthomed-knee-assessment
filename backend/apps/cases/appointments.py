"""Transactional booking, account attachment and repeat-safe QR reception."""
from datetime import datetime, time, timedelta
from time import sleep
from zoneinfo import ZoneInfo

from django.db import OperationalError, connection, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import NotFound

from apps.accounts.models import User
from .models import Appointment, DoctorPatient, DoctorQR, MedicalCase

TEHRAN = ZoneInfo("Asia/Tehran")


def doctor_available(doctor):
    if not doctor.is_active:
        return False
    registration = doctor.role_registrations.filter(role=User.Role.DOCTOR, is_active=True).first()
    return bool(registration and (doctor.is_verified if doctor.role == User.Role.DOCTOR else registration.is_verified))


def attach_case(appointment, patient):
    appointment.patient = patient
    if appointment.case_id is None:
        appointment.case = MedicalCase.objects.create(patient=patient, managing_doctor=appointment.doctor)
    appointment.save(update_fields=("patient", "case"))
    DoctorPatient.objects.get_or_create(doctor=appointment.doctor, patient=patient)
    return appointment


@transaction.atomic
def bind_pending_appointments(patient):
    # Take a write lock before reading: this also serializes SQLite transactions,
    # where select_for_update alone provides no protection.
    User.objects.filter(pk=patient.pk).update(phone_number=F("phone_number"))
    pending = Appointment.objects.select_for_update().filter(
        phone_number=patient.phone_number, patient__isnull=True,
    ).exclude(status=Appointment.Status.CANCELLED).select_related("doctor")
    for appointment in pending:
        attach_case(appointment, patient)


def check_in(token, patient):
    # File-backed SQLite waits using busy_timeout. Its shared-memory test backend
    # instead reports SQLITE_LOCKED immediately; retry the whole transaction.
    for attempt in range(7):
        try:
            return _check_in(token, patient)
        except OperationalError as exc:
            if connection.vendor != "sqlite" or "locked" not in str(exc).lower() or attempt == 6:
                raise
            sleep(0.02 * (2 ** attempt))


@transaction.atomic
def _check_in(token, patient):
    now = timezone.now()
    if not DoctorQR.objects.filter(token=token, is_active=True).update(last_used_at=now):
        raise NotFound("کد پذیرش نامعتبر یا غیرفعال است.")
    qr = DoctorQR.objects.select_related("doctor").get(token=token)
    if not doctor_available(qr.doctor):
        raise NotFound("پذیرش این پزشک در دسترس نیست.")
    day = timezone.localdate(now, TEHRAN)
    start = datetime.combine(day, time.min, tzinfo=TEHRAN)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=TEHRAN)
    today = Appointment.objects.select_for_update().filter(
        doctor=qr.doctor, phone_number=patient.phone_number,
        scheduled_at__gte=start, scheduled_at__lt=end,
    ).exclude(status=Appointment.Status.CANCELLED)
    appointment = today.filter(status__in=(Appointment.Status.CHECKED_IN, Appointment.Status.COMPLETED)).order_by("-checked_in_at").first()
    if appointment is None:
        # Rank by distance to now, rather than taking an arbitrary morning slot.
        scheduled = list(today.filter(status=Appointment.Status.SCHEDULED))
        appointment = min(scheduled, key=lambda item: abs((item.scheduled_at - now).total_seconds())) if scheduled else None
        if appointment is None:
            appointment = Appointment.objects.create(
                doctor=qr.doctor, phone_number=patient.phone_number,
                scheduled_at=now, source=Appointment.Source.QR,
            )
        appointment.status = Appointment.Status.CHECKED_IN
        appointment.checked_in_at = now
        appointment.save(update_fields=("status", "checked_in_at"))
    return attach_case(appointment, patient)
