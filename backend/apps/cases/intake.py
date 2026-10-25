"""Previsit options and scoring transcribed from questions.docx (not a validated instrument)."""
COMMON_CONDITIONS = ("diabetes", "cardiovascular", "hypertension", "stroke", "peripheral_vascular", "pulmonary", "renal", "inflammatory_arthritis", "parkinsons", "neurological", "none")
RED_FLAGS = ("fever", "hot_swollen", "unable_to_bear_weight", "wound", "other", "none")
PAINKILLERS = ("دیکلوفناک", "ناپروکسن", "ملوکسیکام", "استامینوفن", "فاروکسی فن", "گاباپنتین", "پره گابالین", "other")
HIGH_RISK = ("anticoagulants", "long_term_steroids", "immunosuppression", "dvt_pe", "none")
COMPARTMENTS = ("medial", "lateral", "patellofemoral", "multiple")


def previsit_scores(case):
    q = getattr(case, "questionnaire", None)
    if not q or q.intake_version != "2.0":
        return None
    required = (q.worst_pain_month, q.walking_pain, q.daily_activity_pain)
    if any(value is None for value in required) or not q.walking_capacity or not q.stair_difficulty:
        return None
    pain = (q.worst_pain_month + q.walking_pain) / 2 * 3
    function = {"under_2": 15, "2_to_5": 10, "5_to_10": 5, "over_10": 0}[q.walking_capacity]
    function += {"none": 0, "pain": 6, "support": 10, "unable": 15}[q.stair_difficulty] + q.daily_activity_pain
    chronic = 0 if q.pain_duration_months < 6 else 5 if q.pain_duration_months <= 12 else 10
    treatment = 8 if q.physiotherapy_sessions == "10_plus" and q.physiotherapy_effect in ("none", "partial") else 4 if q.physiotherapy_sessions == "under_10" and q.physiotherapy_effect == "none" else 0
    if q.had_intra_articular_injection and q.injection_effect in ("temporary", "none"):
        treatment += 6
    if q.takes_painkillers:
        treatment += {"none": 4, "low": 3, "moderate": 2, "high": 0}.get(q.analgesic_effect, 0)
    treatment += {"none": 2, "partial": 1, "good": 0}.get(q.weight_loss_effect, 2) if q.weight_loss_attempted else 2
    a = round(min(100, pain + function + chronic + treatment), 1)
    bmi = q.bmi
    b = 0 if bmi is None or bmi < 30 else 8 if bmi < 35 else 14 if bmi < 40 else 20
    b += {"none": 0, "controlled": 10, "uncontrolled": 25}.get(q.diabetes_status, 0)
    b += {"never": 0, "former": 5, "current": 15}[q.smoking_status]
    disease_weights = {"cardiovascular": 10, "hypertension": 6, "stroke": 8, "peripheral_vascular": 8, "pulmonary": 6, "renal": 6, "inflammatory_arthritis": 6, "parkinsons": 8, "neurological": 8}
    b += min(25, sum(disease_weights.get(value, 0) for value in set(q.common_conditions)))
    doctor = case.assessments.filter(source="doctor").first()
    if doctor:
        if doctor.active_infection:
            b = max(b, 70)
        if set(doctor.high_risk_conditions) - {"none"}:
            b = min(100, b + 10)
    c = min(100, sum({"fever": 40, "hot_swollen": 50, "unable_to_bear_weight": 80, "wound": 80}.get(value, 0) for value in set(q.red_flags)))
    if c >= 70:
        color, action = "red", "فوریت/ارجاع سریع"
    elif c >= 40:
        color, action = "yellow", "ویزیت سریع/تماس"
    elif b >= 60:
        color, action = ("yellow" if a >= 40 else "green"), "کاهش عوامل خطر پیش از تصمیم جراحی"
    elif a >= 70:
        color, action = "orange", "کاندید بالقوه؛ تکمیل ارزیابی و برنامه‌ریزی"
    elif a >= 40:
        color, action = "yellow", "مرزی؛ معاینه و تکمیل ارزیابی"
    else:
        color, action = "green", "پیگیری مسیر غیرجراحی و ارزیابی"
    return {"a": a, "b": b, "c": c, "color": color, "action": action,
            "risk_unknown": q.diabetes_status == "unknown", "other_red_flag": "other" in q.red_flags}
