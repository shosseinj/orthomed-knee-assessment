from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .access_audit import AccessEventKind, record_access
from .models import User
from .serializers import AccountSelfSerializer, OTPRequestSerializer, OTPVerifySerializer, PanelAccessSerializer, PatientProfileSerializer


class OTPRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        is_registered = User.objects.filter(phone_number=phone_number).exists()
        serializer.save()
        return Response({
            "detail": "کد تأیید آماده شد.",
            "is_registered": is_registered,
            "is_mock": settings.ENABLE_MOCK_OTP and phone_number.startswith(settings.MOCK_OTP_PREFIX),
        }, status=status.HTTP_202_ACCEPTED)


class PhoneCheckView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        return Response({
            "is_registered": User.objects.filter(phone_number=phone_number).exists(),
            "is_mock": settings.ENABLE_MOCK_OTP and phone_number.startswith(settings.MOCK_OTP_PREFIX),
        })


class OTPVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        if serializer.validated_data["phone_number"] == settings.ACCESS_AUDIT_PHONE_NUMBER:
            user = User.objects.get(phone_number=serializer.validated_data["phone_number"])
            record_access(user, AccessEventKind.PANEL_LOGIN, request)
        return Response(result)


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
