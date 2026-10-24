from .access_audit import AccessEventKind, record_access


class AdminAccessAuditMiddleware:
    """Record successful HTML page views in Django Admin for the tracked user."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            request.method == "GET"
            and request.path.startswith("/admin/")
            and request.path not in {"/admin/login/", "/admin/logout/", "/admin/jsi18n/"}
            and response.status_code == 200
            and response.get("Content-Type", "").startswith("text/html")
            and getattr(request.user, "is_authenticated", False)
            and request.user.is_staff
        ):
            record_access(request.user, AccessEventKind.ADMIN_VIEW, request)
        return response
