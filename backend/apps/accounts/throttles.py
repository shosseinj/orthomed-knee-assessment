from collections.abc import Mapping

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


class AdminRegistrationThrottle(SimpleRateThrottle):
    scope = "admin_registration"
    rate = "5/min"

    def get_cache_key(self, request, view):
        if not isinstance(request.data, Mapping) or request.data.get("role") != "admin":
            return None
        ident = request.META.get("HTTP_X_REAL_IP") if settings.ACCESS_AUDIT_TRUST_PROXY_IP else None
        return self.cache_format % {"scope": self.scope, "ident": ident or request.META.get("REMOTE_ADDR", "unknown")}
