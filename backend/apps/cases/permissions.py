from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.accounts.models import User


class CaseAccessPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.role in (User.Role.DOCTOR, User.Role.INSURANCE) and not request.user.is_verified:
            return False
        if request.method == "POST" and getattr(view, "action", None) == "create":
            return request.user.role in (User.Role.PATIENT, User.Role.DOCTOR)
        return True

    def has_object_permission(self, request, view, obj):
        case = getattr(obj, "case", obj)
        if request.user.role == User.Role.PATIENT:
            return case.patient_id == request.user.id and (request.method in SAFE_METHODS or case.status == case.Status.DRAFT)
        if request.user.role == User.Role.DOCTOR:
            if case.status == case.Status.DRAFT:
                return case.managing_doctor_id == request.user.id
            is_assessment_write = getattr(view, "action", None) in ("doctor_assessment", "ai_assessment", "womac")
            return request.method in SAFE_METHODS or is_assessment_write
        if request.user.role == User.Role.INSURANCE:
            is_decision_write = getattr(view, "action", None) == "insurance_decision"
            return (request.method in SAFE_METHODS or is_decision_write) and case.status in (case.Status.UNDER_REVIEW, case.Status.COMPLETED)
        return False
