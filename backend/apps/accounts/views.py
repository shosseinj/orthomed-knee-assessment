from django.conf import settings
from django.views.decorators.debug import sensitive_variables, sensitive_post_parameters
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .access_audit import AccessEventKind, record_access
from .models import AISettings, User
from .ai_settings import save_api_key, settings_status
from .services import SMSDeliveryError, otp_metadata
from .serializers import AISettingsSerializer, AccountSelfSerializer, OTPRequestSerializer, OTPVerifySerializer, PanelAccessSerializer, PatientProfileSerializer, RegistrationSerializer


@method_decorator(sensitive_post_parameters("openai_api_key"), name="dispatch")
class AISettingsView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def get(self, request):
        return Response(settings_status(request.user))

    @sensitive_variables()
    def put(self, request):
        serializer = AISettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        save_api_key(request.user, serializer.validated_data["openai_api_key"])
        return Response(settings_status(request.user))

    def delete(self, request):
        AISettings.objects.filter(user=request.user).delete()
        return Response(settings_status(request.user))


class OTPDeliveryUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "ارسال کد تأیید ممکن نشد. کمی بعد دوباره تلاش کنید."
    default_code = "otp_delivery_unavailable"


class OTPRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        try:
            serializer.save()
        except SMSDeliveryError:
            raise OTPDeliveryUnavailable() from None
        return Response({
            "detail": "کد تأیید آماده شد.",
            **otp_metadata(phone_number),
        }, status=status.HTTP_202_ACCEPTED)


class OTPVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        if not result["registration_required"] and serializer.validated_data["phone_number"] == settings.ACCESS_AUDIT_PHONE_NUMBER:
            user = User.objects.get(phone_number=serializer.validated_data["phone_number"])
            record_access(user, AccessEventKind.PANEL_LOGIN, request)
        return Response(result)


class RegistrationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        if serializer.validated_data["phone_number"] == settings.ACCESS_AUDIT_PHONE_NUMBER:
            user = User.objects.get(phone_number=serializer.validated_data["phone_number"])
            record_access(user, AccessEventKind.PANEL_LOGIN, request)
        return Response(result, status=status.HTTP_201_CREATED)


class PanelAccessView(APIView):
    def post(self, request):
        serializer = PanelAccessSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record_access(
            request.user,
            AccessEventKind.PANEL_VIEW,
            request,
            path=serializer.validated_data["path"],
            client_timezone=serializer.validated_data.get("client_timezone", ""),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(AccountSelfSerializer(request.user).data)

    def patch(self, request):
        if request.user.role != User.Role.PATIENT:
            raise PermissionDenied("تنها بیمار می‌تواند پروفایل خود را از این بخش ویرایش کند.")
        serializer = PatientProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(AccountSelfSerializer(request.user).data)
