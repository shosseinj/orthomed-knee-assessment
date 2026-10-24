from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import MedicalCaseViewSet, XRayImageViewSet, catalog_options

router = DefaultRouter()
router.register("cases", MedicalCaseViewSet, basename="case")
router.register("images", XRayImageViewSet, basename="image")
urlpatterns = [
    path("catalogs/<str:catalog_name>/", catalog_options, name="catalog-options"),
] + router.urls
