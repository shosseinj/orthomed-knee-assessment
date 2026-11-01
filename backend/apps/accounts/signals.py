import uuid

from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver
from django.db.models.signals import post_save

from .access_audit import AccessEventKind, record_access
from .models import RoleRegistration, User


@receiver(post_save, sender=User)
def sync_primary_registration(sender, instance, raw=False, **kwargs):
    if raw:
        return
    # Preserve the original role fields for existing integrations and admin tools.
    registration = RoleRegistration.objects.filter(user=instance, role=instance.role).first()
    values = dict(is_verified=instance.is_verified, is_active=instance.is_active,
                  medical_council_number=instance.medical_council_number,
                  organization_name=instance.organization_name)
    if registration:
        # Identity activation is global; a disabled role stays disabled when
        # unrelated identity fields are saved.
        values.pop("is_active")
        RoleRegistration.objects.filter(pk=registration.pk).update(**values)
    else:
        registration_id = uuid.uuid4() if instance.role_registrations.exists() else instance.pk
        RoleRegistration.objects.create(id=registration_id, user=instance, role=instance.role,
                                        date_joined=instance.date_joined, **values)


@receiver(user_logged_in)
def audit_admin_login(sender, request, user, **kwargs):
    if request and request.path.startswith("/admin/") and user.is_staff:
        record_access(user, AccessEventKind.ADMIN_LOGIN, request)
