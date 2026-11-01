from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import OTPChallenge, RoleRegistration, User


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
        selected = queryset.exclude(role=User.Role.PATIENT)
        updated = selected.update(is_verified=True)
        for user in selected:
            RoleRegistration.objects.filter(user=user, role=user.role).update(is_verified=True)
        self.message_user(request, f"{updated} حساب تأیید شد.")

    @admin.action(description="لغو تأیید حساب‌های انتخاب‌شده")
    def revoke_approval(self, request, queryset):
        selected = queryset.exclude(role=User.Role.PATIENT)
        updated = selected.update(is_verified=False)
        for user in selected:
            RoleRegistration.objects.filter(user=user, role=user.role).update(is_verified=False)
        self.message_user(request, f"تأیید {updated} حساب لغو شد.")


@admin.register(OTPChallenge)
class OTPChallengeAdmin(admin.ModelAdmin):
    list_display = ("phone_number", "created_at", "expires_at", "consumed_at", "attempts")
    readonly_fields = ("code_hash",)


@admin.register(RoleRegistration)
class RoleRegistrationAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "is_verified", "is_active")
    list_filter = ("role", "is_verified", "is_active")
    readonly_fields = ("user", "role", "date_joined")
    search_fields = ("user__phone_number", "user__national_code", "medical_council_number", "organization_name")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if obj.role == obj.user.role:
            obj.user.is_verified = obj.is_verified
            obj.user.medical_council_number = obj.medical_council_number
            obj.user.organization_name = obj.organization_name
            obj.user.save(update_fields=["is_verified", "medical_council_number", "organization_name"])
