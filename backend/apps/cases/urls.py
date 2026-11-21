from django.urls import path
from rest_framework.routers import DefaultRouter

from .appointment_views import AppointmentViewSet, doctor_qr, qr_reception
from .views import MedicalCaseViewSet, XRayImageViewSet, catalog_options

router = DefaultRouter()
router.register("cases", MedicalCaseViewSet, basename="case")
router.register("images", XRayImageViewSet, basename="image")
router.register("appointments", AppointmentViewSet, basename="appointment")
urlpatterns = [
    path("doctor-qr/", doctor_qr, name="doctor-qr"),
    path("reception/<uuid:token>/", qr_reception, name="qr-reception"),
    path("catalogs/<str:catalog_name>/", catalog_options, name="catalog-options"),
] + router.urls
