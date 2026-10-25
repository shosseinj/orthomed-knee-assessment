import { DatePicker } from "./BirthDatePicker";
import { Field, ValidatedForm, type FieldErrors } from "./ValidatedForm";
import { useState, type ReactNode } from "react";
import { Activity, ChevronLeft, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import type { Questionnaire } from "../types";
import { t, locale } from "../i18n";
import { MultiSelectField } from "./MultiSelectField";
import { Choices, FormSection, ScoreField, SelectField } from "./PrevisitFields";
import { ANALGESIC_EFFECT, COMMON_CONDITIONS, DIABETES, INJECTION_EFFECT, INJECTION_TIME, KNEES, NIGHT_PAIN, PAINKILLERS, PT_EFFECT, PT_SESSIONS, RED_FLAGS, SMOKING, STAIRS, WALKING, WEIGHT_EFFECT, YES_NO } from "../data/previsit";

function DurationField({ months, onChange }: { months: number; onChange: (v: number) => void }) {
  const [unit, setUnit] = useState(months >= 12 && months % 12 === 0 ? "years" : "months");
  const [text, setText] = useState(months ? String(months >= 12 && months % 12 === 0 ? months / 12 : months) : "");
  return <Field as="div" name="pain_duration_months" className="field"><label htmlFor="pain-duration">{t("مدت علائم")} <b className="required-mark">*</b></label><div className="duration-input"><input name="pain_duration_months" id="pain-duration" type="number" required min="0" max={unit === "years" ? 120 : 1440} step={unit === "years" ? "any" : 1} value={text} onChange={(e) => { setText(e.target.value); onChange(Math.round(Number(e.target.value) * (unit === "years" ? 12 : 1))); }} /><select aria-label={t("واحد مدت علائم")} value={unit} onChange={(e) => { const next = e.target.value; setUnit(next); setText(text ? String(next === "years" ? Number((months / 12).toFixed(2)) : months) : ""); }}><option value="months">{t("ماه")}</option><option value="years">{t("سال")}</option></select></div><small>{t(months < 6 ? "کمتر از ۶ ماه" : months <= 12 ? "۶ ماه تا یک سال" : "بیشتر از یک سال")} {months >= 12 && `(${(months / 12).toLocaleString(locale(), { maximumFractionDigits: 1 })} ${t("سال")})`}</small></Field>;
}
export function QuestionnaireForm({ value, onChange, onSave, busy, labAttachments, fieldErrors }: { value: Questionnaire; onChange: (v: Questionnaire) => void; onSave: () => void; busy: boolean; labAttachments?: ReactNode; fieldErrors?: FieldErrors }) {
  const update = <K extends keyof Questionnaire>(key: K, next: Questionnaire[K]) => onChange({ ...value, intake_version: "2.0", [key]: next });
  const bmi = value.height_cm && value.weight_kg ? (Number(value.weight_kg) / ((Number(value.height_cm) / 100) ** 2)).toFixed(1) : "—";
  const boolValue = (v?: boolean | null) => v == null ? "" : v ? "yes" : "no";
  return <section className="content-card form-card wizard-card">
    <header className="section-title section-title--featured"><span><Activity /></span><div><small className="step-kicker">{t("مرحله اول از سه")}</small><h3>{t("شرح حال و سابقه درمان")}</h3><p>{t("فرم پیش‌ویزیت درد زانو؛ وضعیت معمول خود را با دقت ثبت کنید.")}</p></div></header>
    <ValidatedForm errors={fieldErrors} onSubmit={(e) => { e.preventDefault(); onSave(); }}>
    <div className="required-note"><span>*</span> {t("موارد ستاره‌دار الزامی هستند.")}</div>
    <div className="form-grid">
      <FormSection title="A) اطلاعات پایه" />
      <Field name="age_years" className="field"><span>{t("سن")} <b className="required-mark">*</b></span><input name="age_years" type="number" min="1" max="120" required value={value.age_years ?? ""} onChange={(e) => update("age_years", e.target.value ? Number(e.target.value) : null)} /></Field>
      <SelectField name="gender" label="جنسیت" required value={value.gender} options={[["female", "زن"], ["male", "مرد"], ["other", "دیگر / ترجیح می‌دهم نگویم"]]} onChange={(v) => update("gender", v as Questionnaire["gender"])} />
      <Field name="height_cm" className="field"><span>{t("قد (سانتی‌متر)")} <b className="required-mark">*</b></span><input name="height_cm" type="number" min="80" max="240" required value={value.height_cm ?? ""} onChange={(e) => update("height_cm", e.target.value || null)} /></Field>
      <Field name="weight_kg" className="field"><span>{t("وزن (کیلوگرم)")} <b className="required-mark">*</b></span><input name="weight_kg" type="number" min="20" max="350" step="0.1" required value={value.weight_kg ?? ""} onChange={(e) => update("weight_kg", e.target.value || null)} /></Field>
      <div className="bmi-panel field--full" aria-live="polite"><span><Activity size={22} /></span><div><small>{t("شاخص توده بدنی (BMI)")}</small><strong>{bmi}</strong></div><p>{t("این مقدار بر اساس قد و وزن شما به‌صورت خودکار محاسبه می‌شود.")}</p></div>
      <SelectField name="affected_knee" label="زانوی درگیر" required value={value.affected_knee} options={KNEES} onChange={(v) => update("affected_knee", v)} />
      <DurationField months={value.pain_duration_months} onChange={(v) => update("pain_duration_months", v)} />
      <FormSection title="B) درد" />
      <ScoreField name="pain_level" label="درد امروز (۰ تا ۱۰)" value={value.pain_level} onChange={(v) => update("pain_level", v)} />
      <ScoreField name="worst_pain_month" label="بدترین درد یک ماه اخیر (۰ تا ۱۰)" value={value.worst_pain_month} onChange={(v) => update("worst_pain_month", v)} />
      <ScoreField name="walking_pain" label="درد هنگام راه رفتن (۰ تا ۱۰)" value={value.walking_pain} onChange={(v) => update("walking_pain", v)} />
      <SelectField name="night_pain_frequency" label="درد شبانه" required value={value.night_pain_frequency} options={NIGHT_PAIN} onChange={(v) => onChange({ ...value, intake_version: "2.0", night_pain_frequency: v, has_night_pain: v !== "none" })} />
      <FormSection title="C) عملکرد و کیفیت زندگی" />
      <SelectField name="walking_capacity" label="بدون توقف و نشستن، در یک روز عادی چقدر می‌توانید راه بروید؟" required value={value.walking_capacity} options={WALKING} onChange={(v) => onChange({ ...value, intake_version: "2.0", walking_capacity: v, mobility_limit: ({ under_2: "severe", "2_to_5": "moderate", "5_to_10": "mild", over_10: "none" } as const)[v as "under_2" | "2_to_5" | "5_to_10" | "over_10"] })} />
      <SelectField name="stair_difficulty" label="موقع بالا رفتن از پله" required value={value.stair_difficulty} options={STAIRS} onChange={(v) => update("stair_difficulty", v)} />
      <ScoreField name="daily_activity_pain" label="سختی انجام کارهای روزمره به‌خاطر درد زانو (۰ تا ۱۰)" value={value.daily_activity_pain} onChange={(v) => onChange({ ...value, intake_version: "2.0", daily_activity_pain: v, daily_life_impact: v === 0 ? "none" : v <= 3 ? "mild" : v <= 6 ? "moderate" : "severe" })} />
      <ScoreField name="sleep_disruption" label="اختلال خواب به علت درد زانو (۰ تا ۱۰)" value={value.sleep_disruption} onChange={(v) => update("sleep_disruption", v)} />
      <FormSection title="D) درمان‌های انجام‌شده" />
      <SelectField name="physiotherapy_sessions" label="فیزیوتراپی" required value={value.physiotherapy_sessions} options={PT_SESSIONS} onChange={(v) => onChange({ ...value, intake_version: "2.0", physiotherapy_sessions: v, physiotherapy_effect: v === "none" ? "not_tried" : "", previous_treatments: v === "none" ? value.previous_treatments.filter((x) => x !== "فیزیوتراپی") : [...new Set([...value.previous_treatments, "فیزیوتراپی"])] })} />
      <SelectField name="physiotherapy_effect" label="اثر فیزیوتراپی" required value={value.physiotherapy_effect} options={value.physiotherapy_sessions === "none" ? PT_EFFECT.filter(([k]) => k === "not_tried") : PT_EFFECT.filter(([k]) => k !== "not_tried")} onChange={(v) => update("physiotherapy_effect", v)} />
      <SelectField name="had_intra_articular_injection" label="تزریق داخل مفصل زانو داشته‌اید؟" required value={value.had_intra_articular_injection ? "yes" : "no"} options={YES_NO} onChange={(v) => onChange({ ...value, intake_version: "2.0", had_intra_articular_injection: v === "yes", ...(v === "no" ? { injection_types: [], injection_other: "", injection_rounds: 0, injection_effect: "not_tried", injection_last_time: "" } : { injection_effect: "" }) })} />
      {value.had_intra_articular_injection && <>
        <Choices name="injection_types" required label="نوع تزریق داخل مفصل" values={value.injection_types} options={["کورتون", "هیالورونیک اسید", "PRP", "سایر"].map((v) => [v, v])} onChange={(v) => update("injection_types", v)} />
        {value.injection_types.includes("سایر") && <Field name="injection_other" className="field field--full"><span>{t("توضیح نوع تزریق (مثلاً اگزوزوم یا سلول بنیادی)")}</span><input name="injection_other" required maxLength={240} value={value.injection_other || ""} onChange={(e) => update("injection_other", e.target.value)} /></Field>}
        <SelectField name="injection_effect" label="اثر تزریق" required value={value.injection_effect} options={INJECTION_EFFECT} onChange={(v) => update("injection_effect", v)} />
        <SelectField name="injection_rounds" label="چند نوبت تزریق داشته‌اید؟" required value={String(value.injection_rounds)} options={[["1", "۱ نوبت"], ["2", "۲ نوبت"], ["3", "۳ نوبت یا بیشتر"], ["0", "یادم نیست"]]} onChange={(v) => update("injection_rounds", Number(v))} />
        <SelectField name="injection_last_time" label="آخرین نوبت تزریق چه زمانی بوده؟" required value={value.injection_last_time} options={INJECTION_TIME} onChange={(v) => update("injection_last_time", v)} />
      </>}
      <FormSection title="E) دارو و سبک زندگی" />
      <SelectField name="takes_painkillers" label="آیا برای درد زانو مسکن مصرف می‌کنید؟" required value={boolValue(value.takes_painkillers)} options={[["yes", "بله"], ["no", "مسکن مصرف نمی‌کنم"]]} onChange={(v) => onChange({ ...value, intake_version: "2.0", takes_painkillers: v ? v === "yes" : null, ...(v === "no" ? { painkillers: [], painkiller_other: "", analgesic_effect: "" } : {}) })} />
      {value.takes_painkillers && <>
        <details className="painkiller-picker field--full"><summary>{t("انتخاب مسکن‌ها (امکان انتخاب چند مورد)")}{value.painkillers?.length ? `: ${value.painkillers.map((v) => t(v === "other" ? "سایر" : v)).join(t("، "))}` : ""}</summary><Choices name="painkillers" required label="از کدام مسکن‌ها بیشتر استفاده می‌کنید؟ (انتخاب چند مورد)" values={value.painkillers || []} options={PAINKILLERS.map((v) => [v, v === "other" ? "سایر" : v])} onChange={(v) => update("painkillers", v)} /></details>
        {value.painkillers?.includes("other") && <Field name="painkiller_other" className="field field--full"><span>{t("نام سایر مسکن‌ها")}</span><input name="painkiller_other" required maxLength={240} value={value.painkiller_other || ""} onChange={(e) => update("painkiller_other", e.target.value)} /></Field>}
        <SelectField name="analgesic_effect" label="پاسخ درد به مسکن‌ها" required value={value.analgesic_effect} options={ANALGESIC_EFFECT} onChange={(v) => update("analgesic_effect", v)} />
      </>}
      <MultiSelectField catalog="medications" label={t("سایر داروهای مصرفی")} placeholder={t("جست‌وجوی نام فارسی یا انگلیسی دارو...")} values={value.medications} onChange={(v) => update("medications", v)} />
      <SelectField name="weight_loss_attempted" label="آیا برای کمتر شدن درد زانو اقدام به کاهش وزن کرده‌اید؟" required value={boolValue(value.weight_loss_attempted)} options={YES_NO} onChange={(v) => onChange({ ...value, intake_version: "2.0", weight_loss_attempted: v ? v === "yes" : null, weight_loss_effect: "" })} />
      {value.weight_loss_attempted && <SelectField name="weight_loss_effect" label="آیا کاهش وزن تأثیری روی درد زانوی شما داشته است؟" required value={value.weight_loss_effect} options={WEIGHT_EFFECT} onChange={(v) => update("weight_loss_effect", v)} />}
      <FormSection title="F) بیماری‌ها، عوامل خطر و علائم هشدار" />
      <Choices name="common_conditions" required label="بیماری‌های زمینه‌ای مهم (هر موردی را دارید انتخاب کنید) *" values={value.common_conditions || []} options={COMMON_CONDITIONS} onChange={(v) => onChange({ ...value, intake_version: "2.0", common_conditions: v, diabetes_status: v.includes("diabetes") ? value.diabetes_status === "none" ? "unknown" : value.diabetes_status : "none", ...(!v.includes("diabetes") ? { fasting_glucose: null, hba1c: null } : {}) })} />
      <MultiSelectField catalog="diseases" label={t("سایر بیماری‌های زمینه‌ای")} placeholder={t("جست‌وجوی نام بیماری...")} values={value.underlying_conditions} onChange={(v) => update("underlying_conditions", v)} />
      <Field name="condition_notes" className="field field--full"><span>{t("یادداشت کوتاه بیماری‌های زمینه‌ای (اختیاری)")}</span><textarea name="condition_notes" rows={2} value={value.condition_notes || ""} onChange={(e) => update("condition_notes", e.target.value)} /></Field>
      <SelectField name="diabetes_status" label="وضعیت دیابت" required value={value.diabetes_status} options={DIABETES} onChange={(v) => onChange({ ...value, intake_version: "2.0", diabetes_status: v as Questionnaire["diabetes_status"], common_conditions: v === "none" ? (value.common_conditions || []).filter((x) => x !== "diabetes") : [...new Set([...(value.common_conditions || []).filter((x) => x !== "none"), "diabetes"])], ...(v === "none" ? { fasting_glucose: null, hba1c: null } : {}) })} />
      {value.diabetes_status !== "none" && <>
        <Field name="fasting_glucose" className="field"><span>{t("قند خون ناشتا (mg/dL)")}</span><input name="fasting_glucose" type="number" min="1" max="2000" step="0.01" value={value.fasting_glucose ?? ""} onChange={(e) => update("fasting_glucose", e.target.value || null)} /></Field>
        <Field name="hba1c" className="field"><span>{t("قند سه‌ماهه HbA1c (٪)")}</span><input name="hba1c" type="number" min="1" max="30" step="0.01" value={value.hba1c ?? ""} onChange={(e) => update("hba1c", e.target.value || null)} /></Field>
        <div className="field--full">{labAttachments}</div>
      </>}
      <SelectField name="smoking_status" label="سابقه مصرف سیگار/نیکوتین" required value={value.smoking_status} options={SMOKING} onChange={(v) => onChange({ ...value, intake_version: "2.0", smoking_status: v as Questionnaire["smoking_status"], ...(v === "never" ? { smoking_start_date: null, smoking_end_date: null } : v === "current" ? { smoking_end_date: null } : {}) })} />
      {value.smoking_status !== "never" && <Field as="div" name="smoking_start_date" className="field"><span>{t("تاریخ شروع مصرف دخانیات")}</span><DatePicker name="smoking_start_date" label="تاریخ شروع مصرف دخانیات" value={value.smoking_start_date || ""} onChange={(date) => update("smoking_start_date", date || null)} /></Field>}
      {value.smoking_status === "former" && <Field as="div" name="smoking_end_date" className="field"><span>{t("تاریخ ترک دخانیات")}</span><DatePicker name="smoking_end_date" label="تاریخ ترک دخانیات" min={value.smoking_start_date || undefined} value={value.smoking_end_date || ""} onChange={(date) => update("smoking_end_date", date || null)} /></Field>}
      <Choices name="red_flags" required label="علائم هشدار (هر موردی هست انتخاب کنید) *" values={value.red_flags || []} options={RED_FLAGS} onChange={(v) => update("red_flags", v)} />
      {value.red_flags?.includes("other") && <Field name="red_flags_other" className="field field--full"><span>{t("توضیح سایر علائم هشدار")}</span><textarea name="red_flags_other" required rows={3} value={value.red_flags_other || ""} onChange={(e) => update("red_flags_other", e.target.value)} /></Field>}
      <label className="switch-row field--full"><input type="checkbox" checked={value.uses_walking_aid} onChange={(e) => update("uses_walking_aid", e.target.checked)} /><span className="switch" /><span>{t("از عصا یا واکر استفاده می‌کنم")}</span></label>
      <Field name="additional_notes" className="field field--full"><span>{t("توضیحات تکمیلی")}</span><textarea name="additional_notes" rows={4} value={value.additional_notes} onChange={(e) => update("additional_notes", e.target.value)} /></Field>
    </div>
    <div className="wizard-actions"><span className="autosave-hint"><ShieldCheck size={16} /> {t("اطلاعات شما محرمانه نگهداری می‌شود.")}</span><button type="submit" className="button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} {t("ذخیره و ادامه")} <ChevronLeft size={18} /></button></div>
    </ValidatedForm>
  </section>;
}
