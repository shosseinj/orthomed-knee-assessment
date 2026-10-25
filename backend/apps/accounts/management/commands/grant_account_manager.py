from django.contrib.auth.models import Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.accounts.serializers import normalize_phone


class Command(BaseCommand):
    help = "Grant account-verification management to an existing registered mobile number."

    def add_arguments(self, parser):
        parser.add_argument("phone_number")

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            phone = normalize_phone(options["phone_number"])
        except Exception as exc:
            raise CommandError("شماره موبایل معتبر نیست.") from exc
        user = User.objects.select_for_update().filter(phone_number=phone, is_active=True).first()
        if not user:
            raise CommandError("ابتدا با این شماره ثبت‌نام کنید؛ حساب باید فعال باشد.")
        permission = Permission.objects.get(content_type__app_label="accounts", codename="manage_account_verifications")
        user.is_staff = True
        user.save(update_fields=["is_staff"])
        user.user_permissions.add(permission)
        self.stdout.write(self.style.SUCCESS(f"Account manager enabled for {phone}. Sign in and open /management."))
