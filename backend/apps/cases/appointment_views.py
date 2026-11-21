import base64
import io
import uuid
from urllib.parse import urlsplit

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.generics import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.accounts.serializers import CasePatientSerializer, DoctorIdentitySerializer, normalize_phone
from .appointments import attach_case, check_in, doctor_available
from .models import Appointment, DoctorQR


class AppointmentSerializer(serializers.ModelSerializer):
    doctor = DoctorIdentitySerializer(read_only=True)
    patient = CasePatientSerializer(read_only=True)
    case_id = serializers.UUIDField(read_only=True, allow_null=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Appointment
        fields = ("id", "doctor", "patient", "phone_number", "scheduled_at", "source", "status", "status_label", "case_id", "checked_in_at")
        read_only_fields = fields


class BookingInput(serializers.Serializer):
    phone_number = serializers.CharField()
    scheduled_at = serializers.DateTimeField()

    def validate_phone_number(self, value):
        return normalize_phone(value)

    def validate_scheduled_at(self, value):
        value = value.replace(second=0, microsecond=0)
        if value <= timezone.now():
            raise serializers.ValidationError("زمان نوبت باید در آینده باشد.")
        return value


def require_doctor(user):
    if user.active_role != User.Role.DOCTOR or not user.active_is_verified:
        raise PermissionDenied("تنها پزشک تأییدشده به این بخش دسترسی دارد.")


class AppointmentViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AppointmentSerializer

    def get_queryset(self):
        user = self.request.user
        queryset = Appointment.objects.select_related("doctor", "patient", "case")
        if user.active_role == User.Role.DOCTOR:
            require_doctor(user)
            return queryset.filter(doctor=user)
        if user.active_role == User.Role.PATIENT:
            return queryset.filter(patient=user)
        raise PermissionDenied()

    def list(self, request):
        queryset = self.get_queryset()
        if request.query_params.get("active") == "1":
            queryset = queryset.exclude(status__in=(Appointment.Status.COMPLETED, Appointment.Status.CANCELLED))
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    def create(self, request):
        require_doctor(request.user)
        serializer = BookingInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                # Serialize booking with QR check-in and other bookings.
                User.objects.filter(pk=request.user.pk).update(phone_number=F("phone_number"))
                DoctorQR.objects.get_or_create(doctor=request.user)
                DoctorQR.objects.filter(doctor=request.user).update(last_used_at=F("last_used_at"))
                appointment = Appointment.objects.create(doctor=request.user, **serializer.validated_data)
                patient = User.objects.filter(
                    phone_number=appointment.phone_number, is_active=True,
                    role_registrations__role=User.Role.PATIENT, role_registrations__is_active=True,
                ).first()
                if patient:
                    attach_case(appointment, patient)
        except IntegrityError:
            raise ValidationError({"scheduled_at": "در این ساعت نوبت دیگری ثبت شده است."}) from None
        return Response(self.get_serializer(appointment).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        require_doctor(request.user)
        if set(request.data) - {"scheduled_at", "status"}:
            raise ValidationError("فقط زمان یا وضعیت نوبت قابل تغییر است.")
        try:
            with transaction.atomic():
                DoctorQR.objects.filter(doctor=request.user).update(last_used_at=F("last_used_at"))
                appointment = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
                target = request.data.get("status", appointment.status)
                if appointment.status == Appointment.Status.SCHEDULED:
                    if target not in (Appointment.Status.SCHEDULED, Appointment.Status.CANCELLED, Appointment.Status.CHECKED_IN):
                        raise ValidationError("ابتدا بیمار را پذیرش کنید.")
                    if target == Appointment.Status.CHECKED_IN:
                        if not appointment.patient_id:
                            raise ValidationError("بیمار باید ابتدا ثبت‌نام کند.")
                        appointment.checked_in_at = timezone.now()
                    if "scheduled_at" in request.data:
                        if target != Appointment.Status.SCHEDULED:
                            raise ValidationError("تغییر زمان و پذیرش یا لغو را جداگانه ثبت کنید.")
                        values = BookingInput(data={"phone_number": appointment.phone_number, "scheduled_at": request.data["scheduled_at"]})
                        values.is_valid(raise_exception=True)
                        appointment.scheduled_at = values.validated_data["scheduled_at"]
                elif appointment.status == Appointment.Status.CHECKED_IN and target == Appointment.Status.COMPLETED and "scheduled_at" not in request.data:
                    pass
                else:
                    raise ValidationError("تغییر این نوبت در وضعیت فعلی مجاز نیست.")
                appointment.status = target
                appointment.save(update_fields=("status", "scheduled_at", "checked_in_at"))
        except IntegrityError:
            raise ValidationError({"scheduled_at": "در این ساعت نوبت دیگری ثبت شده است."}) from None
        return Response(self.get_serializer(appointment).data)


@api_view(["GET", "PATCH", "POST"])
@permission_classes([IsAuthenticated])
def doctor_qr(request):
    require_doctor(request.user)
    with transaction.atomic():
        qr, _ = DoctorQR.objects.get_or_create(doctor=request.user)
        if request.method != "GET":
            # Lock before loading so rotate/disable cannot lose concurrent changes.
            DoctorQR.objects.filter(pk=qr.pk).update(last_used_at=F("last_used_at"))
            qr.refresh_from_db()
            if request.method == "POST":
                qr.token = uuid.uuid4()
                qr.is_active = True
            else:
                if set(request.data) != {"is_active"} or type(request.data["is_active"]) is not bool:
                    raise ValidationError("وضعیت فعال بودن کد را مشخص کنید.")
                qr.is_active = request.data["is_active"]
            qr.save(update_fields=("token", "is_active"))
    origin = settings.FRONTEND_PUBLIC_URL.rstrip("/")
    parsed = urlsplit(origin)
    if parsed.scheme not in ("https", "http") or not parsed.netloc or parsed.path or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValidationError("آدرس عمومی برنامه برای تولید QR تنظیم نشده است.")
    url = f"{origin}/check-in/{qr.token}"
    import qrcode
    buffer = io.BytesIO()
    qrcode.make(url).save(buffer, format="PNG")
    return Response({
        "token": str(qr.token), "is_active": qr.is_active, "url": url,
        "doctor": DoctorIdentitySerializer(request.user).data,
        "image": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
    })


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def qr_reception(request, token):
    qr = get_object_or_404(DoctorQR.objects.select_related("doctor"), token=token, is_active=True)
    if not doctor_available(qr.doctor):
        raise NotFound("پذیرش این پزشک در دسترس نیست.")
    if request.method == "GET":
        # Public identity intentionally excludes contact details and national ID.
        registration = qr.doctor.role_registrations.get(role=User.Role.DOCTOR)
        return Response({"doctor": {
            "full_name": f"{qr.doctor.first_name} {qr.doctor.last_name}".strip() or "پزشک",
            "medical_council_number": registration.medical_council_number,
        }})
    if not request.user.is_authenticated or request.user.active_role != User.Role.PATIENT:
        raise PermissionDenied("برای پذیرش با حساب بیمار وارد شوید.")
    return Response(AppointmentSerializer(check_in(token, request.user)).data)
