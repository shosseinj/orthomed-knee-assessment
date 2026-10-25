import { Field, ValidatedForm } from "./ValidatedForm";
import { useState, type FormEvent } from "react";
import { Save, Stethoscope, LoaderCircle } from "lucide-react";
import { apiErrorMessage, apiFieldErrors, casesApi } from "../api/client";
import type { Assessment, Verdict } from "../types";
import { t } from "../i18n";
import { COMPARTMENTS, HIGH_RISK, YES_NO, type DoctorExamination } from "../data/previsit";
import { Choices, FormSection, SelectField } from "./PrevisitFields";
import { Toast } from "./Toast";

export function DoctorForm({ initial, id, onSaved }: { initial?: Assessment; id: string; onSaved: () => void }) {
  const [verdict, setVerdict] = useState<Verdict>(initial?.verdict || "inconclusive");
  const [history, setHistory] = useState(initial?.clinical_history || "");
  const [rationale, setRationale] = useState(initial?.rationale || "");
  const [backPain, setBackPain] = useState(initial?.has_lower_back_pain ?? null);
  const [hipPain, setHipPain] = useState(initial?.has_hip_pain ?? null);
  const [klGrade, setKlGrade] = useState<number | null>(initial?.kl_grade ?? null);
  const [radiographicOA, setRadiographicOA] = useState(initial?.radiographic_oa_confirmed ?? null);
  const [riskOptimization, setRiskOptimization] = useState(initial?.risk_optimization || "not_assessed");
  const [expectations, setExpectations] = useState(initial?.expectation_notes || "");
  const [exam, setExam] = useState<DoctorExamination>({ retropatellar_pain: initial?.retropatellar_pain, flexion_degrees: initial?.flexion_degrees, extension_degrees: initial?.extension_degrees, ligament_stability: initial?.ligament_stability, limb_alignment: initial?.limb_alignment, standing_xray: initial?.standing_xray, compartments: initial?.compartments || [], active_infection: initial?.active_infection, high_risk_conditions: initial?.high_risk_conditions || [], educated_about_tka: initial?.educated_about_tka, realistic_expectations: initial?.realistic_expectations });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const update = <K extends keyof DoctorExamination>(key: K, value: DoctorExamination[K]) => setExam({ ...exam, [key]: value });
  const boolValue = (v?: boolean | null) => v == null ? "" : v ? "yes" : "no";
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    setFieldErrors({});
    try { await casesApi.saveDoctorAssessment(id, { ...exam, verdict, clinical_history: history, rationale, has_lower_back_pain: backPain, has_hip_pain: hipPain, kl_grade: klGrade, radiographic_oa_confirmed: radiographicOA, risk_optimization: riskOptimization, expectation_notes: expectations }); onSaved(); }
    catch (e) { setFieldErrors(apiFieldErrors(e)); setError(apiErrorMessage(e, "ثبت نظر ممکن نشد. یافته‌های معاینه و استدلال را کامل کنید.")); }
    finally { setBusy(false); }
  }
  return <section className="content-card doctor-form"><Toast message={error} tone="error" onDismiss={() => setError("")} /><header className="section-title"><span><Stethoscope /></span><div><h3>{t("معاینه و نظر پزشکی")}</h3><p>{t("یافته‌های بالینی و رادیوگرافی را مستقل از پاسخ بیمار ثبت کنید.")}</p></div></header><ValidatedForm errors={fieldErrors} onSubmit={save}>
    <FormSection title="P1) بررسی منبع درد" />
    <SelectField name="has_lower_back_pain" label="کمردرد با انتشار به زانو (رادیکولار)" required value={boolValue(backPain)} options={YES_NO} onChange={(v) => setBackPain(v ? v === "yes" : null)} />
    <SelectField name="has_hip_pain" label="شواهد درگیری لگن/هیپ در معاینه یا تصویربرداری" required value={boolValue(hipPain)} options={YES_NO} onChange={(v) => setHipPain(v ? v === "yes" : null)} />
    <FormSection title="P2) معاینه بالینی زانو" />
    <SelectField name="retropatellar_pain" label="درد رتروپاتلا (پشت کشکک) دارد؟" required value={boolValue(exam.retropatellar_pain)} options={YES_NO} onChange={(v) => update("retropatellar_pain", v ? v === "yes" : null)} />
    <Field name="flexion_degrees" className="field"><span>{t("فلکشن (درجه)")}</span><input name="flexion_degrees" type="number" min="0" max="180" required value={exam.flexion_degrees ?? ""} onChange={(e) => update("flexion_degrees", e.target.value === "" ? null : Number(e.target.value))} /></Field>
    <Field name="extension_degrees" className="field"><span>{t("اکستنشن (درجه)")}</span><input name="extension_degrees" type="number" min="-90" max="90" required value={exam.extension_degrees ?? ""} onChange={(e) => update("extension_degrees", e.target.value === "" ? null : Number(e.target.value))} /></Field>
    <SelectField name="ligament_stability" label="ثبات رباطی" required value={exam.ligament_stability} options={[["stable", "پایدار"], ["unstable", "ناپایدار"]]} onChange={(v) => update("ligament_stability", v)} />
    <SelectField name="limb_alignment" label="محور اندام" required value={exam.limb_alignment} options={[["normal", "نرمال"], ["varus", "واروس"], ["valgus", "والگوس"]]} onChange={(v) => update("limb_alignment", v)} />
    <FormSection title="P4) تصویربرداری" />
    <SelectField name="standing_xray" label="X-ray ایستاده زانو انجام شده؟" required value={boolValue(exam.standing_xray)} options={YES_NO} onChange={(v) => update("standing_xray", v ? v === "yes" : null)} />
    <SelectField name="kl_grade" label="درجه Kellgren–Lawrence (در صورت وجود)" value={klGrade == null ? "unknown" : String(klGrade)} options={[["unknown", "قابل برآورد نیست / در دسترس نیست"], ...[0, 1, 2, 3, 4].map((v): [string, string] => [String(v), `KL ${v}`])]} onChange={(v) => setKlGrade(v === "unknown" || !v ? null : Number(v))} />
    <SelectField name="radiographic_oa_confirmed" label="تأیید آرتروز در رادیوگرافی ایستاده" value={boolValue(radiographicOA)} options={YES_NO} onChange={(v) => setRadiographicOA(v ? v === "yes" : null)} />
    <Choices name="compartments" required={exam.standing_xray === true} label="درگیری کمپارتمان‌ها" values={exam.compartments || []} options={COMPARTMENTS} onChange={(v) => update("compartments", v)} />
    <FormSection title="P5) ریسک‌های تکمیلی و ایمنی" />
    <SelectField name="active_infection" label="عفونت فعال یا بیماری سیستمیک کنترل‌نشده وجود دارد؟" required value={boolValue(exam.active_infection)} options={YES_NO} onChange={(v) => update("active_infection", v ? v === "yes" : null)} />
    <Choices name="high_risk_conditions" required label="داروهای پرریسک/شرایط ویژه" values={exam.high_risk_conditions || []} options={HIGH_RISK} onChange={(v) => update("high_risk_conditions", v)} />
    <div className="clinical-help field--full"><strong>{t("کاهش عوامل خطر پیش از تصمیم جراحی")}</strong><p>{t("یعنی بررسی و کنترل عواملی مثل قند خون، فشار خون، وزن، سیگار، عفونت و داروهای پرریسک پیش از تصمیم جراحی. «نیازمند اقدام» یعنی این موارد هنوز به بررسی یا کنترل نیاز دارند؛ «کنترل‌شده» یعنی پزشک آن‌ها را بررسی و مدیریت کرده است.")}</p><p>{t("طبق فرم پیش‌ویزیت، وجود عفونت فعال امتیاز B را دست‌کم به ۷۰ می‌رساند؛ انتخاب هر داروی پرریسک یا سابقه DVT/PE در مجموع ۱۰ امتیاز اضافه می‌کند (سقف ۱۰۰).")}</p></div>
    <SelectField name="risk_optimization" label="وضعیت کنترل عوامل خطر پزشکی" required value={riskOptimization} options={[["not_assessed", "بررسی نشده"], ["needed", "نیازمند اقدام و کنترل عوامل خطر"], ["optimized", "بررسی و کنترل شده"]]} onChange={(v) => setRiskOptimization(v as NonNullable<Assessment["risk_optimization"]>)} />
    <FormSection title="P6) انتظار و تصمیم درمان" />
    <SelectField name="educated_about_tka" label="بیمار درباره نتایج و محدودیت‌های TKA آموزش دیده است؟" required value={boolValue(exam.educated_about_tka)} options={YES_NO} onChange={(v) => update("educated_about_tka", v ? v === "yes" : null)} />
    <SelectField name="realistic_expectations" label="آیا انتظارات بیمار واقع‌بینانه است؟" required value={boolValue(exam.realistic_expectations)} options={YES_NO} onChange={(v) => update("realistic_expectations", v ? v === "yes" : null)} />
    <SelectField name="verdict" label="نتیجه نهایی" required value={verdict} options={[["surgery", "نیاز به جراحی"], ["no_surgery", "عدم نیاز به جراحی"], ["inconclusive", "نیازمند بررسی بیشتر"]]} onChange={(v) => setVerdict(v as Verdict)} />
    <Field name="expectation_notes" className="field field--full"><span>{t("انتظارات و آمادگی بیمار")}</span><textarea name="expectation_notes" rows={3} value={expectations} onChange={(e) => setExpectations(e.target.value)} /></Field>
    <Field name="clinical_history" className="field field--full"><span>{t("شرح حال بیمار")} <small>{t("(اختیاری)")}</small></span><textarea name="clinical_history" rows={4} value={history} onChange={(e) => setHistory(e.target.value)} /></Field>
    <Field name="rationale" className="field field--full"><span>{t("توضیح کوتاه تصمیم")} <b className="required-mark">*</b></span><textarea name="rationale" rows={4} minLength={10} required value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>
    <button className="button field--full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} {t("ثبت نظر نهایی")}</button>
  </ValidatedForm></section>;
}
