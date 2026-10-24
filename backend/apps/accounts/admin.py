from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import OTPChallenge, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-date_joined",)
    list_display = ("phone_number", "full_name", "role", "is_verified", "is_active")
    list_filter = ("role", "is_verified", "is_active")
    actions = ("approve_selected", "revoke_approval")
    fieldsets = ((None, {"fields": ("phone_number", "password")}), ("پروفایل", {"fields": ("first_name", "last_name", "national_code", "birth_date", "role", "medical_council_number", "organization_name", "is_verified")}), ("دسترسی", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}))
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("phone_number", "password1", "password2", "role")}),)
    search_fields = ("phone_number", "national_code", "first_name", "last_name", "medical_council_number", "organization_name")

    @admin.action(description="تأیید حساب‌های انتخاب‌شده")
    def approve_selected(self, request, queryset):
        updated = queryset.exclude(role=User.Role.PATIENT).update(is_verified=True)
        self.message_user(request, f"{updated} حساب تأیید شد.")

    @admin.action(description="لغو تأیید حساب‌های انتخاب‌شده")
    def revoke_approval(self, request, queryset):
        updated = queryset.exclude(role=User.Role.PATIENT).update(is_verified=False)
        self.message_user(request, f"تأیید {updated} حساب لغو شد.")


@admin.register(OTPChallenge)
class OTPChallengeAdmin(admin.ModelAdmin):
    list_display = ("phone_number", "created_at", "expires_at", "consumed_at", "attempts")
    readonly_fields = ("code_hash",)
