from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.accounts.models import User
from .access import can_read_case, intake_is_open


class CaseAccessPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.active_role not in User.CLINICAL_ROLES:
            return False
        if request.user.active_role in (User.Role.DOCTOR, User.Role.INSURANCE) and not request.user.active_is_verified:
            return False
        # New cases must be created transactionally through an appointment.
        if request.method == "POST" and getattr(view, "action", None) == "create":
            return False
        return True

    def has_object_permission(self, request, view, obj):
        case = getattr(obj, "case", obj)
        if request.user.active_role == User.Role.PATIENT:
            return case.patient_id == request.user.id and (request.method in SAFE_METHODS or intake_is_open(case))
        if request.user.active_role == User.Role.DOCTOR:
            if request.method in SAFE_METHODS:
                return can_read_case(request.user, case)
            if case.managing_doctor_id != request.user.id:
                return False
            if case.status == case.Status.DRAFT:
                return intake_is_open(case)
            return getattr(view, "action", None) in ("doctor_assessment", "ai_assessment", "womac")
        if request.user.active_role == User.Role.INSURANCE:
            is_decision_write = getattr(view, "action", None) == "insurance_decision"
            return (request.method in SAFE_METHODS or is_decision_write) and case.status in (case.Status.UNDER_REVIEW, case.Status.COMPLETED)
        return False
