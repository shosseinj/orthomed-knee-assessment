from django.contrib import admin

from .models import Appointment, DoctorQR, Assessment, DoctorPatient, InsuranceDecision, MedicalCase, QuestionnaireResponse, WOMACResponse, XRayImage

admin.site.register(MedicalCase)
admin.site.register(QuestionnaireResponse)
admin.site.register(WOMACResponse)
admin.site.register(XRayImage)
admin.site.register(Assessment)
admin.site.register(InsuranceDecision)
admin.site.register(DoctorPatient)

admin.site.register(Appointment)
admin.site.register(DoctorQR)
