import json

from django.contrib.admin.models import CHANGE, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User
from .permissions import IsAccountManager
from .serializers import AccountListQuerySerializer, AccountReviewSerializer, ManagedAccountSerializer


def managed_accounts():
    return User.objects.filter(role__in=(User.Role.DOCTOR, User.Role.INSURANCE))


class ManagedAccountListView(ListAPIView):
    permission_classes = (IsAuthenticated, IsAccountManager)
    serializer_class = ManagedAccountSerializer

    def get_queryset(self):
        params = AccountListQuerySerializer(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        values = params.validated_data
        queryset = managed_accounts()
        if values.get("role"):
            queryset = queryset.filter(role=values["role"])
        status = values.get("status", "all")
        if status == "pending":
            queryset = queryset.filter(is_verified=False, is_active=True)
        elif status == "verified":
            queryset = queryset.filter(is_verified=True, is_active=True)
        elif status == "inactive":
            queryset = queryset.filter(is_active=False)
        if query := values.get("q", ""):
            query = query.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
            for term in query.split():
                queryset = queryset.filter(Q(first_name__icontains=term) | Q(last_name__icontains=term) | Q(phone_number__icontains=term) | Q(national_code__icontains=term) | Q(medical_council_number__icontains=term) | Q(organization_name__icontains=term))
        return queryset.order_by("-date_joined", "id")

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data["summary"] = managed_accounts().aggregate(
            total=Count("pk"),
            pending=Count("pk", filter=Q(is_verified=False, is_active=True)),
            verified=Count("pk", filter=Q(is_verified=True, is_active=True)),
            inactive=Count("pk", filter=Q(is_active=False)),
        )
        response["Cache-Control"] = "private, no-store"
        return response


class ManagedAccountReviewView(APIView):
    permission_classes = (IsAuthenticated, IsAccountManager)

    @transaction.atomic
    def patch(self, request, pk):
        target = get_object_or_404(managed_accounts().select_for_update(), pk=pk)
        serializer = AccountReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target.is_verified = serializer.validated_data["is_verified"]
        changed = ["is_verified"]
        if target.is_verified and not target.is_active:
            target.is_active = True
            changed.append("is_active")
        target.save(update_fields=changed)
        LogEntry.objects.create(
            user=request.user, content_type=ContentType.objects.get_for_model(User),
            object_id=str(target.pk), object_repr=target.full_name,
            action_flag=CHANGE,
            change_message=json.dumps({"action": "approve_account" if target.is_verified else "revoke_account_approval", "fields": changed}),
        )
        response = Response(ManagedAccountSerializer(target).data)
        response["Cache-Control"] = "private, no-store"
        return response
