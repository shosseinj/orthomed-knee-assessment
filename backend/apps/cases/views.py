import logging
import mimetypes

from django.http import FileResponse
from django.db import transaction
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from apps.accounts.ai_settings import AIKeyUnavailable, get_api_key
from apps.accounts.serializers import normalize_phone
from .catalogs import SUPPORTED_CATALOGS, search_catalog
from .models import Assessment, DoctorPatient, InsuranceDecision, MedicalCase, QuestionnaireResponse, WOMACResponse, XRayImage
from .permissions import CaseAccessPermission
from .serializers import AssessmentSerializer, DoctorPatientSerializer, InsuranceDecisionSerializer, MedicalCaseDetailSerializer, MedicalCaseListSerializer, QuestionnaireSerializer, WOMACSerializer, XRayImageSerializer
from .services import AIProviderError, request_ai_assessment

logger = logging.getLogger(__name__)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def catalog_options(request, catalog_name):
    if catalog_name not in SUPPORTED_CATALOGS:
        return Response({"detail": "فهرست درخواستی معتبر نیست."}, status=status.HTTP_404_NOT_FOUND)
    try:
        limit = min(max(int(request.query_params.get("limit", 25)), 1), 50)
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except (TypeError, ValueError):
        raise ValidationError("تعداد و موقعیت نتایج باید عدد صحیح باشند.")
    query = request.query_params.get("q", "")[:120]
    language = "en" if request.headers.get("Accept-Language", "").lower().startswith("en") else "fa"
    return Response(search_catalog(catalog_name, query, limit, offset, language=language))


class MedicalCaseViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CaseAccessPermission]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        queryset = MedicalCase.objects.select_related("patient", "managing_doctor").prefetch_related("images", "assessments__author")
        if self.request.user.role == User.Role.PATIENT:
            return queryset.filter(patient=self.request.user)
        if self.request.user.role == User.Role.INSURANCE:
            return queryset.filter(status__in=(MedicalCase.Status.UNDER_REVIEW, MedicalCase.Status.COMPLETED))
        return queryset.filter(Q(managing_doctor=self.request.user) | ~Q(status=MedicalCase.Status.DRAFT)).distinct()

    def get_serializer_class(self):
        return MedicalCaseDetailSerializer if self.action == "retrieve" else MedicalCaseListSerializer

    def perform_create(self, serializer):
        if self.request.user.role == User.Role.PATIENT:
            serializer.save(patient=self.request.user)
            return
        patient_id = self.request.data.get("patient_id")
        assignment = DoctorPatient.objects.select_related("patient").filter(
            doctor=self.request.user,
            patient_id=patient_id,
        ).first()
        if not assignment:
            raise ValidationError({"patient_id": "ابتدا بیمار را به فهرست بیماران خود اضافه کنید."})
        serializer.save(patient=assignment.patient, managing_doctor=self.request.user)

    def perform_destroy(self, instance):
        is_patient_owner = self.request.user.role == User.Role.PATIENT and instance.patient_id == self.request.user.id
        is_managing_doctor = self.request.user.role == User.Role.DOCTOR and instance.managing_doctor_id == self.request.user.id
        if not (is_patient_owner or is_managing_doctor):
            raise PermissionDenied("تنها بیمار یا پزشک مسئول می‌تواند پیش‌نویس متعلق به خود را حذف کند.")
        if instance.status != MedicalCase.Status.DRAFT:
            raise ValidationError("پرونده ارسال‌شده قابل حذف نیست.")
        for image in instance.images.all():
            image.image.delete(save=False)
        instance.delete()

    @action(detail=False, methods=["get", "post"], url_path="my-patients")
    def my_patients(self, request):
        if request.user.role != User.Role.DOCTOR or not request.user.is_verified:
            raise PermissionDenied("تنها پزشک تأییدشده به فهرست بیماران دسترسی دارد.")
        if request.method == "POST":
            phone_number = normalize_phone(str(request.data.get("phone_number", "")))
            patient = User.objects.filter(phone_number=phone_number, role=User.Role.PATIENT).first()
            if not patient:
                raise ValidationError({"phone_number": "بیماری با این شماره موبایل ثبت‌نام نکرده است."})
            assignment, created = DoctorPatient.objects.get_or_create(doctor=request.user, patient=patient)
            response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
            return Response(DoctorPatientSerializer(assignment).data, status=response_status)
        assignments = DoctorPatient.objects.filter(doctor=request.user).select_related("patient")
        return Response(DoctorPatientSerializer(assignments, many=True).data)

    @action(detail=True, methods=["put"], url_path="questionnaire")
    def questionnaire(self, request, pk=None):
        case = self.get_object()
        if case.status != MedicalCase.Status.DRAFT:
            raise ValidationError("پرونده ثبت‌شده قابل ویرایش نیست.")
        instance = QuestionnaireResponse.objects.filter(case=case).first()
        serializer = QuestionnaireSerializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(case=case)
        return Response(serializer.data)

    @action(detail=True, methods=["put"], url_path="womac")
    def womac(self, request, pk=None):
        case = self.get_object()
        instance = WOMACResponse.objects.filter(case=case).first()
        can_complete_missing = request.user.role == User.Role.DOCTOR and request.user.is_verified and case.status == MedicalCase.Status.SUBMITTED and instance is None
        if case.status != MedicalCase.Status.DRAFT and not can_complete_missing:
            raise ValidationError("پرونده ثبت‌شده قابل ویرایش نیست.")
        serializer = WOMACSerializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(case=case)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="images", parser_classes=[MultiPartParser, FormParser])
    def upload_image(self, request, pk=None):
        case = self.get_object()
        if case.status != MedicalCase.Status.DRAFT:
            raise ValidationError("پرونده ثبت‌شده قابل ویرایش نیست.")
        serializer = XRayImageSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        image = serializer.save(case=case)
        return Response(XRayImageSerializer(image, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        case = self.get_object()
        if case.status != MedicalCase.Status.DRAFT:
            raise ValidationError("این پرونده قبلاً ثبت شده است.")
        try:
            with transaction.atomic():
                case.submit()
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc
        try:
            request_ai_assessment(case, api_key=get_api_key(request.user))
        except (AIProviderError, AIKeyUnavailable):
            logger.exception("AI assessment failed for case %s; the case remains submitted", case.id)
        return Response(MedicalCaseDetailSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="ai-assessment")
    def ai_assessment(self, request, pk=None):
        if request.user.role != User.Role.DOCTOR or not request.user.is_verified:
            raise PermissionDenied("تنها پزشک تأییدشده می‌تواند تحلیل هوش مصنوعی را درخواست کند.")
        case = self.get_object()
        existing = case.assessments.filter(source=Assessment.Source.AI).first()
        if existing:
            return Response(AssessmentSerializer(existing, context={"request": request}).data)
        if case.status == MedicalCase.Status.DRAFT or not hasattr(case, "questionnaire") or not hasattr(case, "womac") or not case.images.filter(purpose="xray").exists():
            raise ValidationError("ابتدا شرح حال، WOMAC و تصویر زانو را تکمیل و پرونده را ارسال کنید.")
        try:
            api_key = get_api_key(request.user)
        except AIKeyUnavailable:
            return Response({"detail": "کلید ذخیره‌شده قابل خواندن نیست؛ آن را دوباره در تنظیمات وارد کنید."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not api_key:
            return Response({"detail": "سرویس هوش مصنوعی پیکربندی نشده است؛ کلید OpenAI خود را در تنظیمات وارد کنید."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            assessment = request_ai_assessment(case, api_key=api_key)
        except AIProviderError as exc:
            logger.warning("Doctor-requested AI assessment failed for case %s", case.id)
            detail = str(exc) if str(exc) in ("کلید OpenAI پذیرفته نشد؛ آن را در تنظیمات بررسی یا جایگزین کنید.", "سقف مصرف یا تعداد درخواست‌های OpenAI رسیده است؛ اعتبار و محدودیت حساب خود را بررسی کنید.") else "دریافت پاسخ از سرویس هوش مصنوعی ممکن نشد. دوباره تلاش کنید."
            return Response({"detail": detail}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(AssessmentSerializer(assessment, context={"request": request}).data)

    @action(detail=True, methods=["put"], url_path="doctor-assessment")
    def doctor_assessment(self, request, pk=None):
        if request.user.role != User.Role.DOCTOR or not request.user.is_verified:
            raise PermissionDenied("تنها پزشک تأییدشده می‌تواند نظر ثبت کند.")
        with transaction.atomic():
            case = MedicalCase.objects.select_for_update().get(pk=self.get_object().pk)
            instance = Assessment.objects.filter(case=case, source=Assessment.Source.DOCTOR).first()
            if instance and instance.author_id != request.user.id:
                raise PermissionDenied("این پرونده قبلاً توسط پزشک دیگری بررسی و نهایی شده است.")
            if case.status == MedicalCase.Status.COMPLETED:
                raise PermissionDenied("تصمیم بیمه برای این پرونده ثبت شده و نظر پزشکی دیگر قابل ویرایش نیست.")
            if not instance and case.status != MedicalCase.Status.SUBMITTED:
                raise ValidationError("این پرونده در وضعیت قابل بررسی پزشکی نیست.")
            serializer = AssessmentSerializer(instance, data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(case=case, source=Assessment.Source.DOCTOR, author=request.user)
            case.status = MedicalCase.Status.UNDER_REVIEW
            case.save(update_fields=["status", "updated_at"])
        return Response(serializer.data)

    @action(detail=True, methods=["put"], url_path="insurance-decision")
    def insurance_decision(self, request, pk=None):
        if request.user.role != User.Role.INSURANCE or not request.user.is_verified:
            raise PermissionDenied("تنها کارشناس تأییدشده بیمه می‌تواند تصمیم ثبت کند.")
        with transaction.atomic():
            case = MedicalCase.objects.select_for_update().get(pk=self.get_object().pk)
            if not case.assessments.filter(source=Assessment.Source.DOCTOR).exists():
                raise ValidationError("پیش از تصمیم بیمه، ثبت نظر پزشک الزامی است.")
            instance = InsuranceDecision.objects.filter(case=case).first()
            if instance and instance.reviewer_id != request.user.id:
                raise PermissionDenied("این پرونده قبلاً توسط کارشناس دیگری نهایی شده است.")
            serializer = InsuranceDecisionSerializer(instance, data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(case=case, reviewer=request.user)
            case.status = MedicalCase.Status.COMPLETED
            case.save(update_fields=["status", "updated_at"])
        return Response(serializer.data)


class XRayImageViewSet(viewsets.GenericViewSet):
    queryset = XRayImage.objects.select_related("case")
    permission_classes = [IsAuthenticated, CaseAccessPermission]

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        image = self.get_object()
        content_type = mimetypes.guess_type(image.image.name)[0] or "application/octet-stream"
        response = FileResponse(image.image.open("rb"), content_type=content_type)
        response["Content-Disposition"] = f'inline; filename="{image.pk}"'
        response["Cache-Control"] = "private, no-store"
        return response

    def destroy(self, request, pk=None):
        image = self.get_object()
        if image.case.status != MedicalCase.Status.DRAFT:
            raise ValidationError("تصویر پرونده ثبت‌شده قابل حذف نیست.")
        image.delete()
        image.image.delete(save=False)
        return Response(status=status.HTTP_204_NO_CONTENT)
