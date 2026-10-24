import { t, locale, useLocale, catalogLabel } from "../i18n";
import { Activity, AlertCircle, ArrowRight, BrainCircuit, Check, CheckCircle2, ChevronLeft, ChevronRight, FileImage, ImagePlus, LoaderCircle, LockKeyhole, Save, Send, ShieldCheck, Sparkles, Stethoscope, Trash2, UserRound } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFileUrl, casesApi } from "../api/client";
import { MultiSelectField } from "../components/MultiSelectField";
import { StatusBadge } from "../components/StatusBadge";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { KNEE_SUPPLEMENTAL_ITEMS, WOMAC_ITEM_IDS, WOMAC_OPTIONS, WOMAC_SECTIONS } from "../data/womac";
import type { Assessment, InsuranceDecision, MedicalCase, Questionnaire, Role, Verdict } from "../types";
import { ageFromBirthDate } from "../utils/dates";

const emptyQuestionnaire: Questionnaire = { age_years: null, gender: "", underlying_conditions: [], medications: [], height_cm: null, weight_kg: null, pain_level: 5, pain_duration_months: 1, mobility_limit: "moderate", previous_treatments: [], conservative_treatment_rounds: 0, conservative_duration_months: 0, conservative_response: "not_tried", had_intra_articular_injection: false, injection_rounds: 0, injection_types: [], daily_life_impact: "none", smoking_status: "never", diabetes_status: "none", has_night_pain: false, uses_walking_aid: false, additional_notes: "" };
const treatments = ["دارو و مسکن", "فیزیوتراپی", "آب‌درمانی", "کاهش وزن", "اصلاح فعالیت و ورزش"];
const injectionTypes = ["کورتون", "PRP", "هیالورونیک اسید"];
type IntakeStep = 1 | 2 | 3;

function useAuthenticatedImage(source: string) {
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let currentObjectUrl = "";
    setObjectUrl("");
    const token = localStorage.getItem("orthomed_access");
    void fetch(apiFileUrl(source), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) throw new Error("Image request failed");
      return response.blob();
    }).then((blob) => {
      currentObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(currentObjectUrl);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setObjectUrl("");
    });
    return () => {
      controller.abort();
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [source]);
  return objectUrl;
}

function AuthenticatedImage({ source, alt }: { source: string; alt: string }) {
  useLocale();
  const objectUrl = useAuthenticatedImage(source);
  return <img src={objectUrl || undefined} alt={alt} />;
}

function AuthenticatedImageLink({ source }: { source: string }) {
  useLocale();
  const objectUrl = useAuthenticatedImage(source);
  return <a href={objectUrl || undefined} target="_blank" rel="noreferrer"><img src={objectUrl || undefined} alt={t("X-ray زانو")} /><span>{t("مشاهده تصویر اصلی")}</span></a>;
}

export function CaseDetailPage() {
  useLocale();
  const { id } = useParams(); const { user } = useAuth(); const navigate = useNavigate();
  const [item, setItem] = useState<MedicalCase | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>(emptyQuestionnaire);
  const [womacResponses, setWomacResponses] = useState<Record<string, number>>({});
  const [supplementalResponses, setSupplementalResponses] = useState<Record<string, number>>({});
  const [activeStep, setActiveStep] = useState<IntakeStep>(1);
  const stepInitialized = useRef(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");

  const load = () => {
    if (!id) return Promise.resolve();
    return casesApi.get(id).then((data) => {
      setItem(data);
      if (data.questionnaire) setQuestionnaire({ ...data.questionnaire, age_years: data.questionnaire.age_years ?? ageFromBirthDate(data.patient.birth_date) });
      else if (data.status === "draft") setQuestionnaire((current) => current.age_years === null ? { ...current, age_years: ageFromBirthDate(data.patient.birth_date) } : current);
      if (data.womac) {
        setWomacResponses(data.womac.responses);
        setSupplementalResponses(data.womac.supplemental_responses || {});
      }
      if (data.status === "draft" && !stepInitialized.current) {
        setActiveStep(!data.questionnaire ? 1 : !data.womac ? 2 : 3);
        stepInitialized.current = true;
      }
    }).catch(() => setError(t("پرونده پیدا نشد یا اجازه مشاهده آن را ندارید.")));
  };
  useEffect(() => { void load(); }, [id]);
  const canEditIntake = Boolean(item?.can_edit_intake && item.status === "draft");

  function goToStep(step: IntakeStep) {
    setError(""); setActiveStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveQuestionnaire(advance = false) {
    if (!id) return; setBusy(true); setError(""); setMessage("");
    if (!questionnaire.age_years || !questionnaire.gender || !questionnaire.height_cm || !questionnaire.weight_kg) {
      setBusy(false); setError(t("لطفاً فیلدهای ستاره‌دار را کامل کنید.")); return;
    }
    try { await casesApi.saveQuestionnaire(id, questionnaire); setMessage(t("شرح حال با موفقیت ذخیره شد.")); await load(); if (advance) goToStep(2); }
    catch { setError(t("ذخیره پرسش‌نامه ممکن نشد. همه موارد را بررسی کنید.")); }
    finally { setBusy(false); }
  }

  async function upload(file?: File) {
    if (!id || !file) return; setBusy(true); setError(""); setMessage("");
    const data = new FormData(); data.append("image", file); data.append("view", "other");
    try { await casesApi.uploadImage(id, data); setMessage(t("تصویر با موفقیت بارگذاری شد.")); load(); }
    catch { setError(t("بارگذاری تصویر ممکن نشد. فرمت و حجم فایل را بررسی کنید.")); }
    finally { setBusy(false); }
  }

  async function saveWomac(advance = false) {
    if (!id) return; setBusy(true); setError(""); setMessage("");
    try { await casesApi.saveWomac(id, womacResponses, supplementalResponses); setMessage(t("پرسش‌نامه WOMAC و امتیاز آن ذخیره شد.")); await load(); if (advance) goToStep(3); }
    catch { setError(t("برای ذخیره WOMAC باید به هر ۲۴ سؤال پاسخ دهید.")); }
    finally { setBusy(false); }
  }

  async function submitCase() {
    if (!id) return;
    setBusy(true); setError(""); setMessage("");
    try { await casesApi.submit(id); setShowSubmitModal(false); setMessage(t("پرونده برای بررسی ارسال شد.")); load(); }
    catch { setError(t("برای ثبت نهایی، تکمیل شرح حال، WOMAC و حداقل یک تصویر الزامی است.")); }
    finally { setBusy(false); }
  }

  async function deleteDraft() {
    if (!id || !canEditIntake) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await casesApi.deleteCase(id);
      navigate("/dashboard", { replace: true, state: { toast: t("پیش‌نویس با موفقیت حذف شد.") } });
    } catch { setShowDeleteModal(false); setError(t("حذف پیش‌نویس ممکن نشد. پرونده‌های ارسال‌شده قابل حذف نیستند.")); }
    finally { setBusy(false); }
  }

  if (!item && !error) return <div className="creating"><LoaderCircle className="spin" /><p>{t("در حال دریافت پرونده...")}</p></div>;
  if (!item) return <div className="error-state"><AlertCircle /><h2>{error}</h2><button className="button button--secondary" onClick={() => navigate("/dashboard")}>{t("بازگشت")}</button></div>;
  const doctorAssessment = item.assessments?.find((assessment) => assessment.source === "doctor");
  const canDoctorReview = user?.role === "doctor" && Boolean(user.is_verified) && (!doctorAssessment || doctorAssessment.author?.id === user.id) && item.status !== "completed";
  const lockedForDoctor = user?.role === "doctor" && Boolean(doctorAssessment && doctorAssessment.author?.id !== user.id);
  const canInsuranceReview = user?.role === "insurance" && Boolean(user.is_verified) && Boolean(doctorAssessment) && (!item.insurance_decision || item.insurance_decision.is_mine);
  const lockedForInsurance = user?.role === "insurance" && Boolean(item.insurance_decision && !item.insurance_decision.is_mine);

  return <>
    <button className="back-link" onClick={() => navigate("/dashboard")}><ArrowRight size={18} />  {t("بازگشت به پرونده‌ها")}</button>
    <Toast message={error || message} tone={error ? "error" : "success"} onDismiss={() => { setError(""); setMessage(""); }} />
    <section className="case-hero">
      <div><div className="case-hero__title"><span className="patient-avatar"><UserRound /></span><div><span className="eyebrow">{t("پرونده")} {item.id.slice(0, 8).toUpperCase()}</span><h2>{user?.role === "patient" ? t(item.title) : item.patient.full_name}</h2><p>{user?.role !== "patient" && `${item.patient.phone_number} · `}{t("ایجاد در")} {new Date(item.created_at).toLocaleDateString(locale())}</p>{user?.role !== "patient" && <p className="case-hero__identity">{t("کد ملی بیمار:")} <b dir="ltr">{item.patient.national_code || t("ثبت نشده")}</b></p>}</div></div></div>
      <div className="case-hero__actions"><StatusBadge status={item.status} label={item.status_label} />{canEditIntake && <button type="button" className="delete-draft" onClick={() => setShowDeleteModal(true)}><Trash2 size={17} />  {t("حذف پیش‌نویس")}</button>}</div>
    </section>
    {canEditIntake ? <div className="intake-wizard">
      <CaseProgress activeStep={activeStep} hasHistory={Boolean(item.questionnaire)} hasWomac={Boolean(item.womac)} hasImages={Boolean(item.images?.length)} onStepChange={goToStep} />
      <div className="wizard-stage" key={activeStep}>
        {activeStep === 1 && <QuestionnaireForm value={questionnaire} onChange={setQuestionnaire} onSave={() => void saveQuestionnaire(true)} busy={busy} />}
        {activeStep === 2 && <WOMACForm responses={womacResponses} supplemental={supplementalResponses} onChange={setWomacResponses} onSupplementalChange={setSupplementalResponses} onSave={() => void saveWomac(true)} onBack={() => goToStep(1)} busy={busy} />}
        {activeStep === 3 && <div className="final-step"><UploadPanel images={item.images || []} onUpload={upload} busy={busy} /><div className="readiness-card"><span><Sparkles /></span><div><strong>{t("پرونده")} {user?.role === "doctor" ? t("بیمار") : t("شما")}  {t("تقریباً آماده است")}</strong><p>{t("شرح حال، امتیاز WOMAC و تصاویر برای بررسی پزشکی و سامانه تحلیل هوشمند ارسال می‌شوند.")}</p></div><div className="readiness-list"><span className={item.questionnaire ? "ready" : ""}><Check />  {t("شرح حال")}</span><span className={item.womac ? "ready" : ""}><Check /> WOMAC</span><span className={item.images?.length ? "ready" : ""}><Check />  {t("تصویر زانو")}</span></div></div><div className="submit-panel"><span><ShieldCheck /></span><div><h3>{t("ثبت نهایی پرونده")}</h3><p>{t("پس از ثبت نهایی، اطلاعات قفل می‌شوند و برای بررسی ارسال خواهند شد.")}</p></div><button className="button button--ghost" onClick={() => goToStep(2)}><ChevronRight size={18} />  {t("مرحله قبل")}</button><button className="button" disabled={busy || !item.images?.length} onClick={() => setShowSubmitModal(true)}><Send size={18} />  {t("ارسال برای بررسی")}</button></div></div>}
      </div>
      {showSubmitModal && <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && setShowSubmitModal(false)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="submit-modal-title" onMouseDown={(event) => event.stopPropagation()}><span className="confirm-modal__icon"><ShieldCheck /></span><span className="eyebrow">{t("ثبت نهایی پرونده")}</span><h3 id="submit-modal-title">{t("برای ارسال پرونده آماده‌اید؟")}</h3><p>{t("پس از تأیید، پاسخ‌ها و تصاویر قفل می‌شوند و پرونده هم‌زمان در اختیار پزشکان و سامانه تحلیل هوشمند قرار می‌گیرد.")}</p><div className="confirm-modal__notice"><LockKeyhole size={17} />  {t("بعد از ارسال امکان ویرایش وجود ندارد.")}</div><div className="confirm-modal__actions"><button className="button button--ghost" disabled={busy} onClick={() => setShowSubmitModal(false)}>{t("بازگشت و بررسی")}</button><button className="button" disabled={busy} onClick={submitCase}>{busy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}  {t("تأیید و ارسال")}</button></div></section></div>}
      {showDeleteModal && <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && setShowDeleteModal(false)}><section className="confirm-modal confirm-modal--danger" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" onMouseDown={(event) => event.stopPropagation()}><span className="confirm-modal__icon"><Trash2 /></span><span className="eyebrow">{t("حذف پیش‌نویس")}</span><h3 id="delete-modal-title">{t("این پرونده حذف شود؟")}</h3><p>{t("شرح حال، پاسخ‌های WOMAC و تصاویر بارگذاری‌شده این پیش‌نویس برای همیشه حذف می‌شوند.")}</p><div className="confirm-modal__actions"><button className="button button--ghost" disabled={busy} onClick={() => setShowDeleteModal(false)}>{t("انصراف")}</button><button className="button button--danger" disabled={busy} onClick={deleteDraft}>{busy ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}  {t("حذف پیش‌نویس")}</button></div></section></div>}
    </div> : <ReviewView item={item} viewerRole={user?.role || "patient"} canDoctorReview={canDoctorReview} lockedForDoctor={lockedForDoctor} canInsuranceReview={canInsuranceReview} lockedForInsurance={lockedForInsurance} onDoctorSaved={() => { setMessage(t("نظر پزشکی با موفقیت ثبت شد.")); void load(); }} onInsuranceSaved={() => { setMessage(t("تصمیم بیمه با موفقیت ثبت شد.")); void load(); }} />}
  </>;
}

function CaseProgress({ activeStep, hasHistory, hasWomac, hasImages, onStepChange }: { activeStep: IntakeStep; hasHistory: boolean; hasWomac: boolean; hasImages: boolean; onStepChange: (step: IntakeStep) => void }) {
  useLocale();
  const steps: Array<{ number: string; title: string; subtitle: string; done: boolean; available: boolean }> = [
    { number: t("۱"), title: t("شرح حال"), subtitle: t("اطلاعات بالینی"), done: hasHistory, available: true },
    { number: t("۲"), title: "WOMAC", subtitle: t("درد و عملکرد"), done: hasWomac, available: hasHistory },
    { number: t("۳"), title: t("تصاویر و ثبت"), subtitle: t("بازبینی نهایی"), done: hasImages, available: hasWomac },
  ];
  return <nav className="case-progress" aria-label={t("مراحل تکمیل پرونده")}>{steps.map((step, index) => {
    const stepNumber = (index + 1) as IntakeStep;
    return <button type="button" className={`${step.done ? "done" : ""} ${activeStep === stepNumber ? "active" : ""}`} disabled={!step.available} onClick={() => onStepChange(stepNumber)} key={t(step.title)}><span>{step.done ? <Check size={17} /> : step.number}</span><div><strong>{t(step.title)}</strong><small>{t(step.subtitle)}</small></div></button>;
  })}</nav>;
}

function QuestionnaireForm({ value, onChange, onSave, busy }: { value: Questionnaire; onChange: (v: Questionnaire) => void; onSave: () => void; busy: boolean }) {
  useLocale();
  const update = <K extends keyof Questionnaire>(key: K, next: Questionnaire[K]) => onChange({ ...value, [key]: next });
  const toggleTreatment = (name: string) => update("previous_treatments", value.previous_treatments.includes(name) ? value.previous_treatments.filter((x) => x !== name) : [...value.previous_treatments, name]);
  const toggleInjection = (name: string) => update("injection_types", value.injection_types.includes(name) ? value.injection_types.filter((x) => x !== name) : [...value.injection_types, name]);
  const bmi = value.height_cm && value.weight_kg ? (Number(value.weight_kg) / ((Number(value.height_cm) / 100) ** 2)).toFixed(1) : "—";
  return <section className="content-card form-card wizard-card">
    <header className="section-title section-title--featured"><span><ClipboardIcon /></span><div><small className="step-kicker">{t("مرحله اول از سه")}</small><h3>{t("شرح حال و سابقه درمان")}</h3><p>{t("اطلاعات دقیق‌تر به پزشک و تحلیل هوشمند کمک می‌کند تصمیم مطمئن‌تری داشته باشند.")}</p></div></header>
    <div className="required-note"><span>*</span>  {t("موارد ستاره‌دار الزامی هستند.")}</div>
    <div className="form-grid">
      <label className="field"><span>{t("سن")} <Required /></span><input type="number" min="1" max="120" placeholder={t("مثلاً ۶۲ سال")} required value={value.age_years ?? ""} onChange={(e) => update("age_years", e.target.value ? Number(e.target.value) : null)} /></label>
      <label className="field"><span>{t("جنسیت")} <Required /></span><select required value={value.gender} onChange={(e) => update("gender", e.target.value as Questionnaire["gender"])}><option value="">{t("انتخاب کنید")}</option><option value="female">{t("زن")}</option><option value="male">{t("مرد")}</option><option value="other">{t("سایر")}</option></select></label>
      <label className="field"><span>{t("قد (سانتی‌متر)")} <Required /></span><input type="number" min="80" max="240" placeholder={t("مثلاً ۱۷۰")} required value={value.height_cm ?? ""} onChange={(e) => update("height_cm", e.target.value || null)} /></label>
      <label className="field"><span>{t("وزن (کیلوگرم)")} <Required /></span><input type="number" min="20" max="350" step="0.1" placeholder={t("مثلاً ۷۵")} required value={value.weight_kg ?? ""} onChange={(e) => update("weight_kg", e.target.value || null)} /></label>
      <div className="bmi-panel field--full" aria-live="polite"><span><Activity size={22} /></span><div><small>{t("شاخص توده بدنی (BMI)")}</small><strong>{bmi}</strong></div><p>{t("این مقدار بر اساس قد و وزن شما به‌صورت خودکار محاسبه می‌شود.")}</p></div>
      <MultiSelectField catalog="diseases" label={t("بیماری‌های زمینه‌ای")} placeholder={t("جست‌وجوی نام بیماری...")} values={value.underlying_conditions} onChange={(items) => update("underlying_conditions", items)} />
      <MultiSelectField catalog="medications" label={t("داروهای مصرفی")} placeholder={t("جست‌وجوی نام فارسی یا انگلیسی دارو...")} values={value.medications} onChange={(items) => update("medications", items)} />
      <label className="field field--full pain-scale"><span><span className="field-label">{t("شدت درد فعلی")} <Required /></span><b>{value.pain_level.toLocaleString(locale())}  {t("از ۱۰")}</b></span><input className="range" type="range" min="0" max="10" value={value.pain_level} onChange={(e) => update("pain_level", Number(e.target.value))} /><div className="range-labels"><small>{t("بدون درد")}</small><small>{t("بسیار شدید")}</small></div></label>
      <label className="field"><span>{t("مدت درد (ماه)")} <Required /></span><input type="number" min="0" value={value.pain_duration_months} onChange={(e) => update("pain_duration_months", Number(e.target.value))} /></label>
      <label className="field"><span>{t("میزان محدودیت حرکت")}</span><select value={value.mobility_limit} onChange={(e) => update("mobility_limit", e.target.value as Questionnaire["mobility_limit"])}><option value="none">{t("بدون محدودیت")}</option><option value="mild">{t("کم")}</option><option value="moderate">{t("متوسط")}</option><option value="severe">{t("شدید")}</option></select></label>
      <label className="field"><span>{t("اثر درد بر زندگی روزمره")}</span><select value={value.daily_life_impact} onChange={(e) => update("daily_life_impact", e.target.value as Questionnaire["daily_life_impact"])}><option value="none">{t("بدون اختلال")}</option><option value="mild">{t("کم")}</option><option value="moderate">{t("متوسط")}</option><option value="severe">{t("شدید")}</option></select></label>
      <label className="field"><span>{t("وضعیت دیابت")}</span><select value={value.diabetes_status} onChange={(e) => update("diabetes_status", e.target.value as Questionnaire["diabetes_status"])}><option value="none">{t("ندارم")}</option><option value="controlled">{t("کنترل‌شده")}</option><option value="uncontrolled">{t("کنترل‌نشده")}</option><option value="unknown">{t("اطلاع ندارم")}</option></select></label>
      <label className="field"><span>{t("وضعیت مصرف دخانیات")}</span><select value={value.smoking_status} onChange={(e) => update("smoking_status", e.target.value as Questionnaire["smoking_status"])}><option value="never">{t("هرگز")}</option><option value="former">{t("قبلاً مصرف می‌کردم")}</option><option value="current">{t("در حال حاضر")}</option></select></label>
      <span />
      <fieldset className="field field--full"><legend>{t("درمان‌های غیرجراحی انجام‌شده")}</legend><div className="choice-grid">{treatments.map((name) => <label className="choice" key={name}><input type="checkbox" checked={value.previous_treatments.includes(name)} onChange={() => toggleTreatment(name)} /><span><Check size={14} /></span>{t(name)}</label>)}</div></fieldset>
      <label className="field"><span>{t("تعداد دوره‌های درمان غیرجراحی")}</span><input type="number" min="0" value={value.conservative_treatment_rounds} onChange={(e) => update("conservative_treatment_rounds", Number(e.target.value))} /></label>
      <label className="field"><span>{t("مدت مجموع درمان (ماه)")}</span><input type="number" min="0" value={value.conservative_duration_months} onChange={(e) => update("conservative_duration_months", Number(e.target.value))} /></label>
      <label className="field field--full"><span>{t("پاسخ درد به درمان غیرجراحی")}</span><select value={value.conservative_response} onChange={(e) => update("conservative_response", e.target.value as Questionnaire["conservative_response"])}><option value="not_tried">{t("انجام نشده")}</option><option value="none">{t("بدون پاسخ")}</option><option value="partial">{t("پاسخ نسبی")}</option><option value="good">{t("پاسخ مناسب")}</option></select></label>
      <label className="switch-row field--full"><input type="checkbox" checked={value.had_intra_articular_injection} onChange={(e) => update("had_intra_articular_injection", e.target.checked)} /><span className="switch" /><span>{t("تزریق داخل مفصلی داشته‌ام")}</span></label>
      {value.had_intra_articular_injection && <><label className="field"><span>{t("تعداد نوبت تزریق")}</span><input type="number" min="0" value={value.injection_rounds} onChange={(e) => update("injection_rounds", Number(e.target.value))} /></label><fieldset className="field"><legend>{t("نوع تزریق")}</legend><div className="choice-grid">{injectionTypes.map((name) => <label className="choice" key={name}><input type="checkbox" checked={value.injection_types.includes(name)} onChange={() => toggleInjection(name)} /><span><Check size={14} /></span>{t(name)}</label>)}</div></fieldset></>}
      <label className="switch-row"><input type="checkbox" checked={value.has_night_pain} onChange={(e) => update("has_night_pain", e.target.checked)} /><span className="switch" /><span>{t("درد شبانه دارم")}</span></label>
      <label className="switch-row"><input type="checkbox" checked={value.uses_walking_aid} onChange={(e) => update("uses_walking_aid", e.target.checked)} /><span className="switch" /><span>{t("از عصا یا واکر استفاده می‌کنم")}</span></label>
      <label className="field field--full"><span>{t("توضیحات تکمیلی")}</span><textarea rows={4} placeholder={t("هر نکته دیگری که پزشک باید بداند...")} value={value.additional_notes} onChange={(e) => update("additional_notes", e.target.value)} /></label>
    </div>
    <div className="wizard-actions"><span className="autosave-hint"><ShieldCheck size={16} />  {t("اطلاعات شما محرمانه نگهداری می‌شود.")}</span><button className="button" disabled={busy} onClick={onSave}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}  {t("ذخیره و ادامه")} <ChevronLeft size={18} /></button></div>
  </section>;
}

function WOMACForm({ responses, supplemental, onChange, onSupplementalChange, onSave, onBack, busy }: { responses: Record<string, number>; supplemental: Record<string, number>; onChange: (value: Record<string, number>) => void; onSupplementalChange: (value: Record<string, number>) => void; onSave: () => void; onBack: () => void; busy: boolean }) {
  useLocale();
  const answered = WOMAC_ITEM_IDS.filter((id) => responses[id] !== undefined).length;
  const total = WOMAC_ITEM_IDS.reduce((sum, id) => sum + (responses[id] ?? 0), 0);
  const normalized = answered === 24 ? Math.round(total / 96 * 100) : null;
  return <section className="content-card womac-card wizard-card">
    <header className="section-title section-title--featured"><span><Activity /></span><div><small className="step-kicker">{t("مرحله دوم از سه")}</small><h3>{t("پرسش‌نامه WOMAC")}</h3><p>{t("وضعیت زانوی خود را در یک هفته گذشته در نظر بگیرید.")}</p></div><div className="womac-score"><small>{answered.toLocaleString(locale())}  {t("از ۲۴ پاسخ")}</small><strong>{normalized === null ? t("در حال تکمیل") : t("شدت {0}٪", { 0: normalized.toLocaleString(locale()) })}</strong><i style={{ width: `${answered / 24 * 100}%` }} /></div></header>
    {/* <div className="instrument-warning"><AlertCircle size={18} /><p><strong>نسخه آزمایشی فارسی:</strong> این ۲۴ سؤال از بخش WOMAC فایل فارسی ارائه‌شده استخراج شده‌اند. پیش از استفاده بالینی یا بیمه‌ای، اعتبار نسخه و مجوز ابزار باید تأیید شود.</p></div> */}
    <div className="womac-sections">{WOMAC_SECTIONS.map((section) => <section key={section.id}><div className="womac-section-title"><h4>{t(section.title)}</h4><p>{t(section.subtitle)}</p></div><div className="womac-items">{section.items.map(([itemId, label], index) => <div className="womac-item" key={itemId}><div><span>{(index + 1).toLocaleString(locale())}</span><strong>{t(label)} <Required /></strong></div><div className="womac-options">{WOMAC_OPTIONS.map((option, score) => <button type="button" key={option} className={responses[itemId] === score ? "active" : ""} onClick={() => onChange({ ...responses, [itemId]: score })}><span>{score.toLocaleString(locale())}</span>{t(option)}</button>)}</div></div>)}</div></section>)}</div>
    <details className="supplemental" open>
      <summary><span>{t("علائم تکمیلی زانو (اختیاری)")}</span><small>{t("این ۹ پاسخ در امتیاز WOMAC محاسبه نمی‌شوند.")}</small></summary>
      <div className="womac-items">{KNEE_SUPPLEMENTAL_ITEMS.map(([itemId, label], index) => <div className="womac-item" key={itemId}><div><span>{(index + 1).toLocaleString(locale())}</span><strong>{t(label)}</strong></div><div className="womac-options">{WOMAC_OPTIONS.map((option, score) => <button type="button" key={option} className={supplemental[itemId] === score ? "active" : ""} onClick={() => onSupplementalChange({ ...supplemental, [itemId]: score })}><span>{score.toLocaleString(locale())}</span>{t(option)}</button>)}</div></div>)}</div>
    </details>
    <div className="wizard-actions"><button className="button button--ghost" type="button" onClick={onBack}><ChevronRight size={18} />  {t("مرحله قبل")}</button><button className="button" disabled={busy || answered !== 24} onClick={onSave}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}  {t("ذخیره و ادامه")} <ChevronLeft size={18} /></button></div>
  </section>;
}

function UploadPanel({ images, onUpload, busy }: { images: MedicalCase["images"]; onUpload: (file?: File) => void; busy: boolean }) {
  useLocale();
  return <section className="content-card upload-card"><header className="section-title"><span><FileImage /></span><div><h3>{t("تصاویر رادیولوژی")}</h3><p>{t("تصویر واضح و کامل از نمای زانو بارگذاری کنید.")}</p></div></header>
    <label className={`dropzone ${busy ? "disabled" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => onUpload(e.target.files?.[0])} /><span><ImagePlus /></span><strong>{t("تصویر را انتخاب کنید")}</strong><small>{t("JPG، PNG یا WebP تا ۱۲ مگابایت")}</small></label>
    <div className="image-grid">{images?.map((image) => <figure key={image.id}><AuthenticatedImage source={image.image_url} alt={t("تصویر رادیولوژی زانو")} /><figcaption><CheckCircle2 size={15} />  {t("بارگذاری‌شده")}</figcaption></figure>)}</div>
    <div className="upload-tip"><AlertCircle size={18} /><p>{t("برای ارزیابی بهتر، تصویر بدون بازتاب نور و با کیفیت اصلی بارگذاری شود.")}</p></div>
  </section>;
}

function ReviewView({ item, viewerRole, canDoctorReview, lockedForDoctor, canInsuranceReview, lockedForInsurance, onDoctorSaved, onInsuranceSaved }: { item: MedicalCase; viewerRole: Role; canDoctorReview: boolean; lockedForDoctor: boolean; canInsuranceReview: boolean; lockedForInsurance: boolean; onDoctorSaved: () => void; onInsuranceSaved: () => void }) {
  useLocale();
  const assessments = item.assessments || []; const doctor = assessments.find((a) => a.source === "doctor"); const ai = assessments.find((a) => a.source === "ai");
  return <div className={`review-layout ${viewerRole === "patient" ? "review-layout--patient" : ""}`}>
    <div className="review-main">
      {viewerRole === "patient" && <div className="patient-review-notice"><ShieldCheck /><div><strong>{t("پرونده با موفقیت ارسال شده است")}</strong><p>{t("در این صفحه اطلاعات و پاسخ‌های ثبت‌شده در پرونده را مشاهده می‌کنید. نتایج پزشکی و هوش مصنوعی محرمانه‌اند.")}</p></div></div>}
      <section className="content-card"><header className="section-title"><span><FileImage /></span><div><h3>{t("تصاویر رادیولوژی")}</h3><p>{item.images?.length.toLocaleString(locale())}  {t("تصویر پیوست شده")}</p></div></header><div className="xray-gallery">{item.images?.map((image) => <AuthenticatedImageLink source={image.image_url} key={image.id} />)}</div></section>
      <QuestionnaireSummary value={item.questionnaire} />
      {item.womac && <WOMACSummary item={item.womac} />}
      {viewerRole !== "insurance" && item.insurance_decision && <InsuranceDecisionCard decision={item.insurance_decision} />}
      {lockedForDoctor && <div className="doctor-lock-note"><span><LockKeyhole /></span><div><strong>{t("این ویزیت توسط پزشک دیگری نهایی شده است")}</strong><p>{t("برای حفظ یکپارچگی تصمیم پزشکی، نتیجه ثبت‌شده فقط خواندنی است و قابل جایگزینی نیست.")}</p></div></div>}
      {canDoctorReview && <DoctorForm initial={doctor} id={item.id} onSaved={onDoctorSaved} />}
      {viewerRole === "doctor" && !canDoctorReview && doctor && <AssessmentCard assessment={doctor} />}
      {viewerRole === "insurance" && doctor && <AssessmentCard assessment={doctor} />}
      {lockedForInsurance && <div className="doctor-lock-note"><span><LockKeyhole /></span><div><strong>{t("این پرونده توسط کارشناس دیگری نهایی شده است")}</strong><p>{t("تصمیم ثبت‌شده برای حفظ یکپارچگی فرایند فقط خواندنی است.")}</p></div></div>}
      {canInsuranceReview && <InsuranceDecisionForm initial={item.insurance_decision || undefined} id={item.id} onSaved={onInsuranceSaved} />}
      {viewerRole === "insurance" && !canInsuranceReview && item.insurance_decision && <InsuranceDecisionCard decision={item.insurance_decision} />}
    </div>
    {viewerRole !== "patient" && <aside className="review-side"><AssessmentCard assessment={ai} source="ai" />{canDoctorReview && doctor && <AssessmentCard assessment={doctor} />}{!ai && <section className="assessment-card assessment-card--pending"><BrainCircuit /><h3>{t("ارزیابی هوش مصنوعی")}</h3><p>{t("نتیجه هنوز از سرویس تحلیل دریافت نشده است.")}</p></section>}</aside>}
  </div>;
}

function QuestionnaireSummary({ value }: { value?: Questionnaire }) {
  useLocale();
  if (!value) return null;
  const mobility = { none: t("بدون محدودیت"), mild: t("کم"), moderate: t("متوسط"), severe: t("شدید") }[value.mobility_limit];
  const impact = { none: t("بدون اختلال"), mild: t("کم"), moderate: t("متوسط"), severe: t("شدید") }[value.daily_life_impact];
  const response = { not_tried: t("انجام نشده"), none: t("بدون پاسخ"), partial: t("نسبی"), good: t("مناسب") }[value.conservative_response];
  const diabetes = { none: t("ندارد"), controlled: t("کنترل‌شده"), uncontrolled: t("کنترل‌نشده"), unknown: t("نامشخص") }[value.diabetes_status];
  const smoking = { never: t("هرگز"), former: t("قبلاً مصرف می‌کرده"), current: t("در حال حاضر") }[value.smoking_status];
  const gender = value.gender === "female" ? t("زن") : value.gender === "male" ? t("مرد") : value.gender === "other" ? t("سایر") : "—";
  return <section className="content-card"><header className="section-title"><span><ClipboardIcon /></span><div><h3>{t("شرح حال بیمار")}</h3><p>{t("اطلاعات بالینی ثبت‌شده در پرونده")}</p></div></header><div className="summary-grid">
    <Summary label={t("سن / جنسیت")} value={`${value.age_years ?? "—"} / ${gender}`} />
    <Summary label={t("قد / وزن")} value={t("{0} سانتی‌متر / {1} کیلوگرم", { 0: value.height_cm || "—", 1: value.weight_kg || "—" })} />
    <Summary label="BMI" value={value.bmi?.toString() || "—"} />
    <Summary label={t("شدت درد")} value={t("{0} از ۱۰", { 0: value.pain_level.toLocaleString(locale()) })} />
    <Summary label={t("مدت درد")} value={t("{0} ماه", { 0: value.pain_duration_months.toLocaleString(locale()) })} />
    <Summary label={t("محدودیت حرکت")} value={mobility} />
    <Summary label={t("اختلال زندگی روزمره")} value={impact} />
    <Summary label={t("پاسخ به درمان")} value={response} />
    <Summary label={t("دوره / مدت درمان غیرجراحی")} value={t("{0} دوره / {1} ماه", { 0: value.conservative_treatment_rounds.toLocaleString(locale()), 1: value.conservative_duration_months.toLocaleString(locale()) })} />
    <Summary label={t("تزریق داخل مفصلی")} value={value.had_intra_articular_injection ? t("{0} نوبت؛ {1}", { 0: value.injection_rounds.toLocaleString(locale()), 1: value.injection_types.map((name) => t(name)).join("، ") || "نوع ثبت نشده" }) : t("نداشته")} />
    <Summary label={t("دیابت / دخانیات")} value={`${diabetes} / ${smoking}`} />
    <Summary label={t("درد شبانه")} value={value.has_night_pain ? t("دارد") : t("ندارد")} />
    <Summary label={t("وسیله کمک‌حرکتی")} value={value.uses_walking_aid ? t("استفاده می‌کند") : t("استفاده نمی‌کند")} />
    <Summary label={t("درمان‌های قبلی")} value={value.previous_treatments.map((name) => t(name)).join(t("، ")) || t("ثبت نشده")} />
  </div>{(value.underlying_conditions.length > 0 || value.medications.length > 0) && <div className="patient-note"><strong>{t("سوابق پزشکی و داروها")}</strong><p>{value.underlying_conditions.map(catalogLabel).join(t("، ")) || t("بیماری زمینه‌ای ثبت نشده")}<br />{value.medications.map(catalogLabel).join(t("، ")) || t("دارویی ثبت نشده")}</p></div>}{value.additional_notes && <div className="patient-note"><strong>{t("توضیحات بیمار")}</strong><p>{value.additional_notes}</p></div>}</section>;
}

function WOMACSummary({ item }: { item: NonNullable<MedicalCase["womac"]> }) {
  useLocale();
  const supplementalCount = Object.keys(item.supplemental_responses || {}).length;
  return <section className="content-card womac-summary"><header className="section-title"><span><Activity /></span><div><h3>{t("نتیجه WOMAC")}</h3><p>{t("امتیاز شدت بالاتر یعنی درد، خشکی یا محدودیت بیشتر.")}</p></div><strong className="score-ring">{Math.round(Number(item.normalized_score)).toLocaleString(locale())}{t("٪")}</strong></header><div className="summary-grid"><Summary label={t("درد")} value={t("{0} از ۲۰", { 0: item.pain_score.toLocaleString(locale()) })} /><Summary label={t("خشکی")} value={t("{0} از ۸", { 0: item.stiffness_score.toLocaleString(locale()) })} /><Summary label={t("عملکرد")} value={t("{0} از ۶۸", { 0: item.function_score.toLocaleString(locale()) })} /><Summary label={t("امتیاز کل")} value={t("{0} از ۹۶", { 0: item.total_score.toLocaleString(locale()) })} /><Summary label={t("شدت نرمال‌شده")} value={t("{0} از ۱۰۰", { 0: Number(item.normalized_score).toLocaleString(locale()) })} /><Summary label={t("سلامت معکوس")} value={t("{0} از ۱۰۰", { 0: Number(item.health_score).toLocaleString(locale()) })} /></div>
    <details className="response-details"><summary>{t("مشاهده تمام پاسخ‌های WOMAC و علائم تکمیلی")}</summary><div>{WOMAC_SECTIONS.map((section) => <section key={section.id}><h4>{t(section.title)}</h4>{section.items.map(([id, label]) => <p key={id}><span>{t(label)}</span><strong>{t(WOMAC_OPTIONS[item.responses[id]] ?? "—")}</strong></p>)}</section>)}{supplementalCount > 0 && <section><h4>{t("علائم تکمیلی")}</h4>{KNEE_SUPPLEMENTAL_ITEMS.filter(([id]) => item.supplemental_responses[id] !== undefined).map(([id, label]) => <p key={id}><span>{t(label)}</span><strong>{t(WOMAC_OPTIONS[item.supplemental_responses[id]])}</strong></p>)}</section>}</div></details>
  </section>;
}

function Summary({ label, value }: { label: string; value: string }) {
  useLocale(); return <div className="summary-item"><small>{t(label)}</small><strong>{t(value)}</strong></div>; }

function Required() {
  useLocale(); return <b className="required-mark" aria-label={t("الزامی")}>*</b>; }

function AssessmentCard({ assessment, source }: { assessment?: Assessment; source?: "ai" }) {
  useLocale();
  if (!assessment) return null;
  const positive = assessment.verdict === "surgery";
  return <section className={`assessment-card assessment-card--${assessment.source}`}><header><span>{assessment.source === "ai" ? <BrainCircuit /> : <Stethoscope />}</span><div><small>{t(assessment.source_label)}</small><h3>{assessment.source === "ai" ? t("نتیجه تحلیل هوشمند") : t("نظر پزشک")}</h3></div></header><div className={`verdict ${positive ? "verdict--warning" : "verdict--safe"}`}><strong>{t(assessment.verdict_label)}</strong></div><div className="clinical-chips"><span>{t("درجه KL:")} {assessment.kl_grade == null ? t("قابل برآورد نیست") : assessment.kl_grade.toLocaleString(locale())}</span>{assessment.source === "doctor" && <><span>{assessment.radiographic_oa_confirmed ? t("OA تأییدشده") : t("OA تأییدنشده")}</span><span>{assessment.risk_optimization === "optimized" ? t("ریسک بهینه") : assessment.risk_optimization === "needed" ? t("نیازمند بهینه‌سازی") : t("ریسک بررسی‌نشده")}</span></>}</div><div className="assessment-copy"><strong>{t("استدلال")}</strong><p>{assessment.rationale}</p>{assessment.clinical_history && <><strong>{t("شرح حال")}</strong><p>{assessment.clinical_history}</p></>}</div>{source && <footer><AlertCircle size={15} />  {t("این نتیجه جایگزین تشخیص پزشک نیست.")}</footer>}</section>;
}

function InsuranceDecisionCard({ decision }: { decision: InsuranceDecision }) {
  useLocale();
  const approved = decision.decision === "approved";
  return <section className="assessment-card assessment-card--insurance"><header><span><ShieldCheck /></span><div><small>{t("تصمیم نهایی شرکت بیمه")}</small><h3>{t("نتیجه بررسی پوشش جراحی")}</h3></div></header><div className={`verdict ${approved ? "verdict--safe" : "verdict--warning"}`}><strong>{t(decision.decision_label)}</strong><small>{t("ثبت‌شده توسط")} {decision.reviewer_name}</small></div><div className="assessment-copy"><strong>{t("دلیل تصمیم بیمه")}</strong><p>{decision.rationale}</p></div></section>;
}

function InsuranceDecisionForm({ initial, id, onSaved }: { initial?: InsuranceDecision; id: string; onSaved: () => void }) {
  useLocale();
  const [decision, setDecision] = useState<"approved" | "rejected">(initial?.decision || "approved");
  const [rationale, setRationale] = useState(initial?.rationale || "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await casesApi.saveInsuranceDecision(id, { decision, rationale }); onSaved(); }
    catch { setError(t("ثبت تصمیم بیمه ممکن نشد. نتیجه و توضیح را بررسی کنید.")); }
    finally { setBusy(false); }
  }
  return <section className="content-card insurance-form"><Toast message={error} tone="error" onDismiss={() => setError("")} /><header className="section-title"><span><ShieldCheck /></span><div><h3>{t("تصمیم نهایی بیمه")}</h3><p>{t("با درنظرگرفتن اطلاعات بیمار و نتایج پزشک و هوش مصنوعی تصمیم خود را ثبت کنید.")}</p></div></header><form onSubmit={save}><label className="field"><span>{t("نتیجه بررسی")} <Required /></span><select value={decision} onChange={(event) => setDecision(event.target.value as "approved" | "rejected")}><option value="approved">{t("تأیید جراحی")}</option><option value="rejected">{t("عدم تأیید جراحی")}</option></select></label><label className="field"><span>{t("توضیح کوتاه تصمیم")} <Required /></span><textarea rows={5} minLength={10} required value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder={t("دلیل تأیید یا عدم تأیید را ثبت کنید...")} /></label><button className="button" disabled={busy || rationale.trim().length < 10}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}  {t("ثبت تصمیم بیمه")}</button></form></section>;
}

function DoctorForm({ initial, id, onSaved }: { initial?: Assessment; id: string; onSaved: () => void }) {
  useLocale();
  const [verdict, setVerdict] = useState<Verdict>(initial?.verdict || "inconclusive");
  const [history, setHistory] = useState(initial?.clinical_history || "");
  const [rationale, setRationale] = useState(initial?.rationale || "");
  const [backPain, setBackPain] = useState(initial?.has_lower_back_pain ?? false);
  const [hipPain, setHipPain] = useState(initial?.has_hip_pain ?? false);
  const [klGrade, setKlGrade] = useState(initial?.kl_grade ?? 0);
  const [radiographicOA, setRadiographicOA] = useState(initial?.radiographic_oa_confirmed ?? false);
  const [riskOptimization, setRiskOptimization] = useState(initial?.risk_optimization || "not_assessed");
  const [expectations, setExpectations] = useState(initial?.expectation_notes || "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await casesApi.saveDoctorAssessment(id, { verdict, clinical_history: history, rationale, has_lower_back_pain: backPain, has_hip_pain: hipPain, kl_grade: klGrade, radiographic_oa_confirmed: radiographicOA, risk_optimization: riskOptimization, expectation_notes: expectations }); onSaved(); }
    catch { setError(t("ثبت نظر ممکن نشد. یافته‌های معاینه و استدلال را کامل کنید.")); }
    finally { setBusy(false); }
  }
  return <section className="content-card doctor-form"><Toast message={error} tone="error" onDismiss={() => setError("")} /><header className="section-title"><span><Stethoscope /></span><div><h3>{t("معاینه و نظر پزشکی")}</h3><p>{t("یافته‌های بالینی و رادیوگرافی را مستقل از پاسخ بیمار ثبت کنید.")}</p></div></header><form onSubmit={save}>
    <label className="field"><span>{t("درد کمر در معاینه")}</span><select value={backPain ? "yes" : "no"} onChange={(e) => setBackPain(e.target.value === "yes")}><option value="no">{t("ندارد")}</option><option value="yes">{t("دارد")}</option></select></label>
    <label className="field"><span>{t("درد لگن در معاینه")}</span><select value={hipPain ? "yes" : "no"} onChange={(e) => setHipPain(e.target.value === "yes")}><option value="no">{t("ندارد")}</option><option value="yes">{t("دارد")}</option></select></label>
    <label className="field"><span>{t("درجه Kellgren–Lawrence")}</span><select value={klGrade} onChange={(e) => setKlGrade(Number(e.target.value))}>{[0,1,2,3,4].map((grade) => <option value={grade} key={grade}>KL {grade.toLocaleString(locale())}</option>)}</select></label>
    <label className="field"><span>{t("تأیید آرتروز در رادیوگرافی ایستاده")}</span><select value={radiographicOA ? "yes" : "no"} onChange={(e) => setRadiographicOA(e.target.value === "yes")}><option value="no">{t("خیر")}</option><option value="yes">{t("بله")}</option></select></label>
    <label className="field"><span>{t("بهینه‌سازی ریسک پزشکی")}</span><select value={riskOptimization} onChange={(e) => setRiskOptimization(e.target.value as NonNullable<Assessment["risk_optimization"]>)}><option value="not_assessed">{t("بررسی نشده")}</option><option value="needed">{t("نیازمند بهینه‌سازی")}</option><option value="optimized">{t("بهینه‌شده")}</option></select></label>
    <label className="field"><span>{t("نتیجه نهایی")}</span><select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}><option value="surgery">{t("نیاز به جراحی")}</option><option value="no_surgery">{t("عدم نیاز به جراحی")}</option><option value="inconclusive">{t("نیازمند بررسی بیشتر")}</option></select></label>
    <label className="field"><span>{t("انتظارات و آمادگی بیمار")}</span><textarea rows={3} value={expectations} onChange={(e) => setExpectations(e.target.value)} /></label>
    <label className="field field--full"><span>{t("شرح حال بیمار")} <small>{t("(اختیاری)")}</small></span><textarea rows={4} value={history} onChange={(e) => setHistory(e.target.value)} placeholder={t("شرح حال یا نکات تکمیلی معاینه را در صورت نیاز بنویسید...")} /></label>
    <label className="field field--full"><span>{t("توضیح کوتاه تصمیم")} <Required /></span><textarea rows={4} minLength={10} required value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={t("دلیل نیاز یا عدم نیاز به جراحی را خلاصه و روشن توضیح دهید...")} /></label>
    <button className="button field--full" disabled={busy || rationale.trim().length < 10}>{busy ? t("در حال ثبت...") : <><Save size={18} />  {t("ثبت نظر نهایی")}</>}</button>
  </form></section>;
}

function ClipboardIcon() {
  useLocale(); return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5h6M9 12h6M9 16h4"/><rect x="5" y="3" width="14" height="18" rx="2"/></svg>; }
