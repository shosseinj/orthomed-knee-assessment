from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from .permissions import has_management_access


class RoleJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        role = validated_token.get("active_role")
        if role is None:
            # Tokens issued before role-aware sessions retain their original role.
            return user
        if role == "admin":
            allowed = has_management_access(user) and not user.role_registrations.filter(role="admin", is_active=False).exists()
        else:
            allowed = user.role_registrations.filter(role=role, is_active=True).exists()
        if not allowed:
            raise AuthenticationFailed("دسترسی به نقش انتخاب‌شده فعال نیست.")
        user._session_role = role
        return user
