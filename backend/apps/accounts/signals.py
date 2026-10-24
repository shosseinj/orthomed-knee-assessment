from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

from .access_audit import AccessEventKind, record_access


@receiver(user_logged_in)
def audit_admin_login(sender, request, user, **kwargs):
    if request and request.path.startswith("/admin/") and user.is_staff:
        record_access(user, AccessEventKind.ADMIN_LOGIN, request)
