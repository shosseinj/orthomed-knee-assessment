from rest_framework.permissions import BasePermission


def can_manage_accounts(user):
    return bool(user and user.is_authenticated and user.is_active and user.is_staff and (
        user.is_superuser or user.has_perm("accounts.manage_account_verifications")
    ))


class IsAccountManager(BasePermission):
    message = "فقط مدیر سامانه اجازه مدیریت تأیید حساب‌ها را دارد."

    def has_permission(self, request, view):
        return can_manage_accounts(request.user)
