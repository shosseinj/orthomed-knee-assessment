import { Field, ValidatedForm, useClearFieldError } from "../components/ValidatedForm";
import { formatDate } from "../utils/dates";
import { t, locale, useLocale, catalogLabel } from "../i18n";
import { Activity, AlertCircle, ArrowRight, BrainCircuit, Check, CheckCircle2, ChevronLeft, ChevronRight, FileImage, ImagePlus, LoaderCircle, LockKeyhole, Save, Send, ShieldCheck, Sparkles, Stethoscope, Trash2, UserRound } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiErrorMessage, apiFieldErrors, apiFileUrl, casesApi } from "../api/client";
import { QuestionnaireForm } from "../components/PrevisitForm";
import { DoctorForm } from "../components/DoctorForm";
import { PrevisitSummary, PrevisitScoreCard, DoctorExaminationSummary } from "../components/PrevisitSummary";
import { StatusBadge } from "../components/StatusBadge";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { KNEE_SUPPLEMENTAL_ITEMS, WOMAC_ITEM_IDS, WOMAC_OPTIONS, WOMAC_SECTIONS } from "../data/womac";
import type { Assessment, InsuranceDecision, MedicalCase, Questionnaire, Role } from "../types";
import { ageFromBirthDate } from "../utils/dates";

const emptyQuestionnaire: Questionnaire = { age_years: null, gender: "", underlying_conditions: [], medications: [], height_cm: null, weight_kg: null, pain_level: 5, pain_duration_months: 0, mobility_limit: "moderate", previous_treatments: [], conservative_treatment_rounds: 0, conservative_duration_months: 0, conservative_response: "not_tried", had_intra_articular_injection: false, injection_rounds: 0, injection_types: [], daily_life_impact: "none", smoking_status: "never", diabetes_status: "none", has_night_pain: false, uses_walking_aid: false, additional_notes: "" };
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

function AuthenticatedImageLink({ source, label = "X-ray زانو" }: { source: string; label?: string }) {
  useLocale();
  const objectUrl = useAuthenticatedImage(source);
  return <a href={objectUrl || undefined} target="_blank" rel="noreferrer"><img src={objectUrl || undefined} alt={t(label)} /><span>{t("مشاهده تصویر اصلی")}</span></a>;
}

export function CaseDetailPage() {
  useLocale();
  const { id } = useParams(); const { user } = useAuth(); const navigate = useNavigate();
  const [item, setItem] = useState<MedicalCase | null>(null);
  const [questionnaireErrors, setQuestionnaireErrors] = useState<Record<string, string>>({});
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>(emptyQuestionnaire);
  const [womacResponses, setWomacResponses] = useState<Record<string, number>>({});
  const [supplementalResponses, setSupplementalResponses] = useState<Record<string, number>>({});
  const [activeStep, setActiveStep] = useState<IntakeStep>(1);
  const stepInitialized = useRef(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");

  const load = (refreshAnswers = true) => {
    if (!id) return Promise.resolve();
    return casesApi.get(id).then((data) => {
      setItem(data);
      if (refreshAnswers && data.questionnaire) setQuestionnaire({ ...data.questionnaire, age_years: data.questionnaire.age_years ?? ageFromBirthDate(data.patient.birth_date) });
      else if (data.status === "draft") setQuestionnaire((current) => current.age_years === null ? { ...current, age_years: ageFromBirthDate(data.patient.birth_date) } : current);
      if (refreshAnswers && data.womac) {
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
    setQuestionnaireErrors({});
    try { await casesApi.saveQuestionnaire(id, { ...questionnaire, intake_version: "2.0" }); setMessage(t("شرح حال با موفقیت ذخیره شد.")); await load(); if (advance) goToStep(2); }
    catch (e) { setQuestionnaireErrors(apiFieldErrors(e)); setError(apiErrorMessage(e, "ذخیره پرسش‌نامه ممکن نشد. همه موارد را بررسی کنید.")); }
    finally { setBusy(false); }
  }

  async function upload(file?: File, purpose: "xray" | "lab" = "xray") {
    if (!id || !file) return; setBusy(true); setError(""); setMessage("");
    const data = new FormData(); data.append("image", file); data.append("view", "other"); data.append("purpose", purpose);
    try { await casesApi.uploadImage(id, data); setMessage(t("تصویر با موفقیت بارگذاری شد.")); await load(false); }
    catch { setError(t("بارگذاری تصویر ممکن نشد. فرمت و حجم فایل را بررسی کنید.")); }
    finally { setBusy(false); }
  }

  async function removeImage(imageId: string) {
    setBusy(true); setError(""); setMessage("");
    try { await casesApi.deleteImage(imageId); await load(false); setMessage(t("تصویر حذف شد.")); }
    catch { setError(t("حذف تصویر ممکن نشد. دوباره تلاش کنید.")); }
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
  const xrays = (item.images || []).filter((image) => image.purpose !== "lab");
  const labs = (item.images || []).filter((image) => image.purpose === "lab");
  const doctorAssessment = item.assessments?.find((assessment) => assessment.source === "doctor");
  const canDoctorReview = user?.role === "doctor" && Boolean(user.is_verified) && (!doctorAssessment || doctorAssessment.author?.id === user.id) && item.status !== "completed";
  const lockedForDoctor = user?.role === "doctor" && Boolean(doctorAssessment && doctorAssessment.author?.id !== user.id);
  const canInsuranceReview = user?.role === "insurance" && Boolean(user.is_verified) && Boolean(doctorAssessment) && (!item.insurance_decision || item.insurance_decision.is_mine);
  const lockedForInsurance = user?.role === "insurance" && Boolean(item.insurance_decision && !item.insurance_decision.is_mine);

  return <>
    <button className="back-link" onClick={() => navigate("/dashboard")}><ArrowRight size={18} />  {t("بازگشت به پرونده‌ها")}</button>
    <Toast message={error || message} tone={error ? "error" : "success"} onDismiss={() => { setError(""); setMessage(""); }} />
    <section className="case-hero">
      <div><div className="case-hero__title"><span className="patient-avatar"><UserRound /></span><div><span className="eyebrow">{t("پرونده")} {item.id.slice(0, 8).toUpperCase()}</span><h2>{user?.role === "patient" ? t(item.title) : item.patient.full_name}</h2><p>{user?.role !== "patient" && `${item.patient.phone_number} · `}{t("ایجاد در")} {formatDate(item.created_at)}</p>{user?.role !== "patient" && <p className="case-hero__identity">{t("کد ملی بیمار:")} <b dir="ltr">{item.patient.national_code || t("ثبت نشده")}</b></p>}</div></div></div>
      <div className="case-hero__actions"><StatusBadge status={item.status} label={item.status_label} />{canEditIntake && <button type="button" className="delete-draft" onClick={() => setShowDeleteModal(true)}><Trash2 size={17} />  {t("حذف پیش‌نویس")}</button>}</div>
    </section>
    {canEditIntake ? <div className="intake-wizard">
      <CaseProgress activeStep={activeStep} hasHistory={Boolean(item.questionnaire)} hasWomac={Boolean(item.womac)} hasImages={Boolean(xrays.length)} onStepChange={goToStep} />
      <div className="wizard-stage" key={activeStep}>
        {activeStep === 1 && <QuestionnaireForm fieldErrors={questionnaireErrors} value={questionnaire} onChange={setQuestionnaire} onSave={() => void saveQuestionnaire(true)} busy={busy} labAttachments={<UploadPanel purpose="lab" images={labs} onUpload={(file) => upload(file, "lab")} onRemove={removeImage} busy={busy} />} />}
        {activeStep === 2 && <WOMACForm responses={womacResponses} supplemental={supplementalResponses} onChange={setWomacResponses} onSupplementalChange={setSupplementalResponses} onSave={() => void saveWomac(true)} onBack={() => goToStep(1)} busy={busy} />}
        {activeStep === 3 && <div className="final-step"><UploadPanel images={xrays} onUpload={upload} onRemove={removeImage} busy={busy} /><div className="readiness-card"><span><Sparkles /></span><div><strong>{t("پرونده")} {user?.role === "doctor" ? t("بیمار") : t("شما")}  {t("تقریباً آماده است")}</strong><p>{t("شرح حال، امتیاز WOMAC و تصاویر برای بررسی پزشکی و سامانه تحلیل هوشمند ارسال می‌شوند.")}</p></div><div className="readiness-list"><span className={item.questionnaire ? "ready" : ""}><Check />  {t("شرح حال")}</span><span className={item.womac ? "ready" : ""}><Check /> WOMAC</span><span className={xrays.length ? "ready" : ""}><Check />  {t("تصویر زانو")}</span></div></div><div className="submit-panel"><span><ShieldCheck /></span><div><h3>{t("ثبت نهایی پرونده")}</h3><p>{t("پس از ثبت نهایی، اطلاعات قفل می‌شوند و برای بررسی ارسال خواهند شد.")}</p></div><button className="button button--ghost" onClick={() => goToStep(2)}><ChevronRight size={18} />  {t("مرحله قبل")}</button><button className="button" disabled={busy || !xrays.length} onClick={() => setShowSubmitModal(true)}><Send size={18} />  {t("ارسال برای بررسی")}</button></div></div>}
      </div>
      {showSubmitModal && <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && setShowSubmitModal(false)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="submit-modal-title" onMouseDown={(event) => event.stopPropagation()}><span className="confirm-modal__icon"><ShieldCheck /></span><span className="eyebrow">{t("ثبت نهایی پرونده")}</span><h3 id="submit-modal-title">{t("برای ارسال پرونده آماده‌اید؟")}</h3><p>{t("پس از تأیید، پاسخ‌ها و تصاویر قفل می‌شوند و پرونده هم‌زمان در اختیار پزشکان و سامانه تحلیل هوشمند قرار می‌گیرد.")}</p><div className="confirm-modal__notice"><LockKeyhole size={17} />  {t("بعد از ارسال امکان ویرایش وجود ندارد.")}</div><div className="confirm-modal__actions"><button className="button button--ghost" disabled={busy} onClick={() => setShowSubmitModal(false)}>{t("بازگشت و بررسی")}</button><button className="button" disabled={busy} onClick={submitCase}>{busy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}  {t("تأیید و ارسال")}</button></div></section></div>}
      {showDeleteModal && <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && setShowDeleteModal(false)}><section className="confirm-modal confirm-modal--danger" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" onMouseDown={(event) => event.stopPropagation()}><span className="confirm-modal__icon"><Trash2 /></span><span className="eyebrow">{t("حذف پیش‌نویس")}</span><h3 id="delete-modal-title">{t("این پرونده حذف شود؟")}</h3><p>{t("شرح حال، پاسخ‌های WOMAC و تصاویر بارگذاری‌شده این پیش‌نویس برای همیشه حذف می‌شوند.")}</p><div className="confirm-modal__actions"><button className="button button--ghost" disabled={busy} onClick={() => setShowDeleteModal(false)}>{t("انصراف")}</button><button className="button button--danger" disabled={busy} onClick={deleteDraft}>{busy ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}  {t("حذف پیش‌نویس")}</button></div></section></div>}
    </div> : <ReviewView item={item} viewerRole={user?.role || "patient"} canDoctorReview={canDoctorReview} lockedForDoctor={lockedForDoctor} canInsuranceReview={canInsuranceReview} lockedForInsurance={lockedForInsurance} onRefresh={() => void load(false)} onDoctorSaved={() => { setMessage(t("نظر پزشکی با موفقیت ثبت شد.")); void load(); }} onInsuranceSaved={() => { setMessage(t("تصمیم بیمه با موفقیت ثبت شد.")); void load(); }} />}
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

function WomacQuestion({ id, label, index, value, onChange }: { id: string; label: string; index: number; value?: number; onChange: (score: number) => void }) {
  const clearError = useClearFieldError(id);
  return <Field as="div" name={id} className="womac-item" role="group" aria-label={t(label)} requiredGroup selectionCount={value === undefined ? 0 : 1}><div><span>{(index + 1).toLocaleString(locale())}</span><strong>{t(label)} <Required /></strong></div><div className="womac-options">{WOMAC_OPTIONS.map((option, score) => <button type="button" key={option} aria-pressed={value === score} className={value === score ? "active" : ""} onClick={() => { onChange(score); clearError(); }}><span>{score.toLocaleString(locale())}</span>{t(option)}</button>)}</div></Field>;
}

function WOMACForm({ responses, supplemental, onChange, onSupplementalChange, onSave, onBack, busy, clinicalMode = false }: { responses: Record<string, number>; supplemental: Record<string, number>; onChange: (value: Record<string, number>) => void; onSupplementalChange: (value: Record<string, number>) => void; onSave: () => void; onBack: () => void; busy: boolean; clinicalMode?: boolean }) {
  useLocale();
  const answered = WOMAC_ITEM_IDS.filter((id) => responses[id] !== undefined).length;
  const total = WOMAC_ITEM_IDS.reduce((sum, id) => sum + (responses[id] ?? 0), 0);
  const normalized = answered === 24 ? Math.round(total / 96 * 100) : null;
  return <section className="content-card womac-card wizard-card">
    <header className="section-title section-title--featured"><span><Activity /></span><div><small className="step-kicker">{t(clinicalMode ? "P3) ارزیابی عملکرد استاندارد" : "مرحله دوم از سه")}</small><h3>{t("پرسش‌نامه WOMAC")}</h3><p>{t("وضعیت زانوی خود را در یک هفته گذشته در نظر بگیرید.")}</p></div><div className="womac-score"><small>{answered.toLocaleString(locale())}  {t("از ۲۴ پاسخ")}</small><strong>{normalized === null ? t("در حال تکمیل") : t("شدت {0}٪", { 0: normalized.toLocaleString(locale()) })}</strong><i style={{ width: `${answered / 24 * 100}%` }} /></div></header><ValidatedForm onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    {/* <div className="instrument-warning"><AlertCircle size={18} /><p><strong>نسخه آزمایشی فارسی:</strong> این ۲۴ سؤال از بخش WOMAC فایل فارسی ارائه‌شده استخراج شده‌اند. پیش از استفاده بالینی یا بیمه‌ای، اعتبار نسخه و مجوز ابزار باید تأیید شود.</p></div> */}
    <div className="womac-sections">{WOMAC_SECTIONS.map((section) => <section key={section.id}><div className="womac-section-title"><h4>{t(section.title)}</h4><p>{t(section.subtitle)}</p></div><div className="womac-items">{section.items.map(([itemId, label], index) => <WomacQuestion key={itemId} id={itemId} label={label} index={index} value={responses[itemId]} onChange={(score) => onChange({ ...responses, [itemId]: score })} />)}</div></section>)}</div>
    <details className="supplemental" open>
      <summary><span>{t("علائم تکمیلی زانو (اختیاری)")}</span><small>{t("این ۹ پاسخ در امتیاز WOMAC محاسبه نمی‌شوند.")}</small></summary>
      <div className="womac-items">{KNEE_SUPPLEMENTAL_ITEMS.map(([itemId, label], index) => <div className="womac-item" key={itemId}><div><span>{(index + 1).toLocaleString(locale())}</span><strong>{t(label)}</strong></div><div className="womac-options">{WOMAC_OPTIONS.map((option, score) => <button type="button" key={option} className={supplemental[itemId] === score ? "active" : ""} onClick={() => onSupplementalChange({ ...supplemental, [itemId]: score })}><span>{score.toLocaleString(locale())}</span>{t(option)}</button>)}</div></div>)}</div>
    </details>
    <div className="wizard-actions">{!clinicalMode && <button className="button button--ghost" type="button" onClick={onBack}><ChevronRight size={18} />  {t("مرحله قبل")}</button>}<button className="button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}  {t(clinicalMode ? "ذخیره WOMAC" : "ذخیره و ادامه")} <ChevronLeft size={18} /></button></div>
  </ValidatedForm></section>;
}

function UploadPanel({ images, onUpload, onRemove, busy, purpose = "xray" }: { images: MedicalCase["images"]; onUpload: (file?: File) => void; onRemove: (id: string) => void; busy: boolean; purpose?: "xray" | "lab" }) {
  useLocale();
  return <section className="content-card upload-card"><header className="section-title"><span><FileImage /></span><div><h3>{t(purpose === "lab" ? "تصاویر آزمایش" : "تصاویر رادیولوژی")}</h3><p>{t(purpose === "lab" ? "عکس آزمایش قند ناشتا یا HbA1c را بارگذاری کنید (اختیاری)." : "تصویر واضح و کامل از نمای زانو بارگذاری کنید.")}</p></div></header>
    <label className={`dropzone ${busy ? "disabled" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} /><span><ImagePlus /></span><strong>{t("تصویر را انتخاب کنید")}</strong><small>{t("JPG، PNG یا WebP تا ۱۲ مگابایت")}</small></label>
    <div className="image-grid">{images?.map((image, index) => <figure key={image.id}><AuthenticatedImage source={image.image_url} alt={t(purpose === "lab" ? "تصویر آزمایش" : "تصویر رادیولوژی زانو")} /><figcaption><CheckCircle2 size={15} /> {t("بارگذاری‌شده")}<button type="button" className="image-remove" disabled={busy} onClick={() => onRemove(image.id)} aria-label={t("حذف تصویر {0}", { 0: index + 1 })}><Trash2 size={16} /> {t("حذف تصویر")}</button></figcaption></figure>)}</div>
    {purpose === "xray" && <div className="upload-tip"><AlertCircle size={18} /><p>{t("برای ارزیابی بهتر، تصویر بدون بازتاب نور و با کیفیت اصلی بارگذاری شود.")}</p></div>}
  </section>;
}

function ReviewView({ item, viewerRole, canDoctorReview, lockedForDoctor, canInsuranceReview, lockedForInsurance, onDoctorSaved, onInsuranceSaved, onRefresh }: { item: MedicalCase; viewerRole: Role; canDoctorReview: boolean; lockedForDoctor: boolean; canInsuranceReview: boolean; lockedForInsurance: boolean; onDoctorSaved: () => void; onInsuranceSaved: () => void; onRefresh: () => void }) {
  useLocale();
  const assessments = item.assessments || []; const doctor = assessments.find((a) => a.source === "doctor"); const ai = assessments.find((a) => a.source === "ai");
  return <div className={`review-layout ${viewerRole === "patient" ? "review-layout--patient" : ""}`}>
    <div className="review-main">
      {viewerRole === "patient" && <div className="patient-review-notice"><ShieldCheck /><div><strong>{t("پرونده با موفقیت ارسال شده است")}</strong><p>{t("در این صفحه اطلاعات و پاسخ‌های ثبت‌شده در پرونده را مشاهده می‌کنید. نتایج پزشکی و هوش مصنوعی محرمانه‌اند.")}</p></div></div>}
      <section className="content-card"><header className="section-title"><span><FileImage /></span><div><h3>{t("تصاویر رادیولوژی")}</h3><p>{item.images?.filter((image) => image.purpose !== "lab").length.toLocaleString(locale())}  {t("تصویر پیوست شده")}</p></div></header><div className="xray-gallery">{item.images?.filter((image) => image.purpose !== "lab").map((image) => <AuthenticatedImageLink source={image.image_url} key={image.id} />)}</div></section>
      {item.images?.some((image) => image.purpose === "lab") && <section className="content-card"><header className="section-title"><h3>{t("تصاویر آزمایش")}</h3></header><div className="xray-gallery">{item.images.filter((image) => image.purpose === "lab").map((image) => <AuthenticatedImageLink source={image.image_url} label="تصویر آزمایش" key={image.id} />)}</div></section>}
      <QuestionnaireSummary value={item.questionnaire} />
      {item.womac ? <WOMACSummary item={item.womac} /> : canDoctorReview && <DoctorWomacForm id={item.id} onSaved={onRefresh} />}
      {viewerRole !== "insurance" && item.insurance_decision && <InsuranceDecisionCard decision={item.insurance_decision} />}
      {lockedForDoctor && <div className="doctor-lock-note"><span><LockKeyhole /></span><div><strong>{t("این ویزیت توسط پزشک دیگری نهایی شده است")}</strong><p>{t("برای حفظ یکپارچگی تصمیم پزشکی، نتیجه ثبت‌شده فقط خواندنی است و قابل جایگزینی نیست.")}</p></div></div>}
      {canDoctorReview && <DoctorForm initial={doctor} id={item.id} onSaved={onDoctorSaved} />}
      {viewerRole === "doctor" && !canDoctorReview && doctor && <AssessmentCard assessment={doctor} />}
      {viewerRole === "insurance" && doctor && <AssessmentCard assessment={doctor} />}
      {lockedForInsurance && <div className="doctor-lock-note"><span><LockKeyhole /></span><div><strong>{t("این پرونده توسط کارشناس دیگری نهایی شده است")}</strong><p>{t("تصمیم ثبت‌شده برای حفظ یکپارچگی فرایند فقط خواندنی است.")}</p></div></div>}
      {canInsuranceReview && <InsuranceDecisionForm initial={item.insurance_decision || undefined} id={item.id} onSaved={onInsuranceSaved} />}
      {viewerRole === "insurance" && !canInsuranceReview && item.insurance_decision && <InsuranceDecisionCard decision={item.insurance_decision} />}
    </div>
    {viewerRole !== "patient" && <aside className="review-side"><PrevisitScoreCard scores={item.previsit_scores} /><AssessmentCard assessment={ai} source="ai" />{canDoctorReview && doctor && <AssessmentCard assessment={doctor} />}{!ai && <AIRequestPanel id={item.id} canRequest={viewerRole === "doctor"} isDraft={item.status === "draft"} onSaved={onRefresh} />}</aside>}
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
    {value.intake_version !== "2.0" && <><Summary label={t("پاسخ به درمان")} value={response} />
    <Summary label={t("دوره / مدت درمان غیرجراحی")} value={t("{0} دوره / {1} ماه", { 0: value.conservative_treatment_rounds.toLocaleString(locale()), 1: value.conservative_duration_months.toLocaleString(locale()) })} /></>}
    <Summary label={t("تزریق داخل مفصلی")} value={value.had_intra_articular_injection ? t("{0} نوبت؛ {1}", { 0: value.injection_rounds === 0 ? t("یادم نیست") : value.injection_rounds.toLocaleString(locale()), 1: value.injection_types.map((name) => t(name)).join("، ") || "نوع ثبت نشده" }) : t("نداشته")} />
    <Summary label={t("دیابت / دخانیات")} value={`${diabetes} / ${smoking}`} />
    <Summary label={t("درد شبانه")} value={value.has_night_pain ? t("دارد") : t("ندارد")} />
    <Summary label={t("وسیله کمک‌حرکتی")} value={value.uses_walking_aid ? t("استفاده می‌کند") : t("استفاده نمی‌کند")} />
    <Summary label={t("درمان‌های قبلی")} value={value.previous_treatments.map((name) => t(name)).join(t("، ")) || t("ثبت نشده")} />
  </div>{(value.underlying_conditions.length > 0 || value.medications.length > 0) && <div className="patient-note"><strong>{t("سوابق پزشکی و داروها")}</strong><p>{value.underlying_conditions.map(catalogLabel).join(t("، ")) || t("بیماری زمینه‌ای ثبت نشده")}<br />{value.medications.map(catalogLabel).join(t("، ")) || t("دارویی ثبت نشده")}</p></div>}{value.intake_version === "2.0" && <PrevisitSummary value={value} />}{value.additional_notes && <div className="patient-note"><strong>{t("توضیحات بیمار")}</strong><p>{value.additional_notes}</p></div>}</section>;
}

function WOMACSummary({ item }: { item: NonNullable<MedicalCase["womac"]> }) {
  useLocale();
  const supplementalCount = Object.keys(item.supplemental_responses || {}).length;
  return <section className="content-card womac-summary"><header className="section-title"><span><Activity /></span><div><h3>{t("P3) ارزیابی عملکرد استاندارد")} — {t("نتیجه WOMAC")}</h3><p>{t("امتیاز شدت بالاتر یعنی درد، خشکی یا محدودیت بیشتر.")}</p></div><strong className="score-ring">{Math.round(Number(item.normalized_score)).toLocaleString(locale())}{t("٪")}</strong></header><div className="summary-grid"><Summary label={t("درد")} value={t("{0} از ۲۰", { 0: item.pain_score.toLocaleString(locale()) })} /><Summary label={t("خشکی")} value={t("{0} از ۸", { 0: item.stiffness_score.toLocaleString(locale()) })} /><Summary label={t("عملکرد")} value={t("{0} از ۶۸", { 0: item.function_score.toLocaleString(locale()) })} /><Summary label={t("امتیاز کل")} value={t("{0} از ۹۶", { 0: item.total_score.toLocaleString(locale()) })} /><Summary label={t("شدت نرمال‌شده")} value={t("{0} از ۱۰۰", { 0: Number(item.normalized_score).toLocaleString(locale()) })} /><Summary label={t("سلامت معکوس")} value={t("{0} از ۱۰۰", { 0: Number(item.health_score).toLocaleString(locale()) })} /></div>
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
  return <section className={`assessment-card assessment-card--${assessment.source}`}><header><span>{assessment.source === "ai" ? <BrainCircuit /> : <Stethoscope />}</span><div><small>{t(assessment.source_label)}</small><h3>{assessment.source === "ai" ? t("نتیجه تحلیل هوشمند") : t("نظر پزشک")}</h3></div></header><div className={`verdict ${positive ? "verdict--warning" : "verdict--safe"}`}><strong>{t(assessment.verdict_label)}</strong></div><div className="clinical-chips"><span>{t("درجه KL:")} {assessment.kl_grade == null ? t("قابل برآورد نیست") : assessment.kl_grade.toLocaleString(locale())}</span>{assessment.source === "doctor" && <><span>{assessment.radiographic_oa_confirmed ? t("OA تأییدشده") : t("OA تأییدنشده")}</span><span>{assessment.risk_optimization === "optimized" ? t("عوامل خطر کنترل‌شده") : assessment.risk_optimization === "needed" ? t("نیازمند کنترل عوامل خطر") : t("ریسک بررسی‌نشده")}</span></>}</div><div className="assessment-copy"><strong>{t("استدلال")}</strong><p>{assessment.rationale}</p>{assessment.source === "doctor" && <DoctorExaminationSummary value={assessment} />}{assessment.clinical_history && <><strong>{t("شرح حال")}</strong><p>{assessment.clinical_history}</p></>}</div>{source && <footer><AlertCircle size={15} />  {t("این نتیجه جایگزین تشخیص پزشک نیست.")}</footer>}</section>;
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setFieldErrors({}); setBusy(true); setError("");
    try { await casesApi.saveInsuranceDecision(id, { decision, rationale }); onSaved(); }
    catch (e) { setFieldErrors(apiFieldErrors(e)); setError(t("ثبت تصمیم بیمه ممکن نشد. نتیجه و توضیح را بررسی کنید.")); }
    finally { setBusy(false); }
  }
  return <section className="content-card insurance-form"><Toast message={error} tone="error" onDismiss={() => setError("")} /><header className="section-title"><span><ShieldCheck /></span><div><h3>{t("تصمیم نهایی بیمه")}</h3><p>{t("با درنظرگرفتن اطلاعات بیمار و نتایج پزشک و هوش مصنوعی تصمیم خود را ثبت کنید.")}</p></div></header><ValidatedForm errors={fieldErrors} onSubmit={save}><Field name="decision" className="field"><span>{t("نتیجه بررسی")} <Required /></span><select value={decision} onChange={(event) => setDecision(event.target.value as "approved" | "rejected")}><option value="approved">{t("تأیید جراحی")}</option><option value="rejected">{t("عدم تأیید جراحی")}</option></select></Field><Field name="rationale" className="field"><span>{t("توضیح کوتاه تصمیم")} <Required /></span><textarea rows={5} minLength={10} required value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder={t("دلیل تأیید یا عدم تأیید را ثبت کنید...")} /></Field><button className="button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}  {t("ثبت تصمیم بیمه")}</button></ValidatedForm></section>;
}

function ClipboardIcon() {
  useLocale(); return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5h6M9 12h6M9 16h4"/><rect x="5" y="3" width="14" height="18" rx="2"/></svg>; }

function AIRequestPanel({ id, canRequest, isDraft, onSaved }: { id: string; canRequest: boolean; isDraft: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function request() {
    setBusy(true); setError("");
    try { await casesApi.requestAiAssessment(id); onSaved(); }
    catch (e) { setError(apiErrorMessage(e, "دریافت پاسخ از سرویس هوش مصنوعی ممکن نشد. دوباره تلاش کنید.")); }
    finally { setBusy(false); }
  }
  return <section className="assessment-card assessment-card--pending" aria-live="polite"><BrainCircuit /><h3>{t("ارزیابی هوش مصنوعی")}</h3><p>{t(isDraft ? "پس از تکمیل و ارسال پرونده می‌توانید تحلیل هوش مصنوعی را درخواست کنید." : "نتیجه هنوز از سرویس تحلیل دریافت نشده است.")}</p>{canRequest && <><button className="button" type="button" disabled={busy || isDraft} onClick={() => void request()}>{busy ? <LoaderCircle size={18} className="spin" /> : <BrainCircuit size={18} />}{t(busy ? "در حال دریافت نظر هوش مصنوعی..." : error ? "تلاش دوباره برای دریافت نظر هوش مصنوعی" : "دریافت نظر هوش مصنوعی")}</button><Link className="ai-settings-link" to="/settings">{t("تنظیم کلید OpenAI")}</Link></>}{error && <p role="alert" className="ai-error">{error}</p>}</section>;
}

function DoctorWomacForm({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [supplemental, setSupplemental] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try { await casesApi.saveWomac(id, responses, supplemental); onSaved(); }
    catch (e) { setError(apiErrorMessage(e, "برای ذخیره WOMAC باید به هر ۲۴ سؤال پاسخ دهید.")); }
    finally { setBusy(false); }
  }
  return <div><Toast message={error} tone="error" onDismiss={() => setError("")} /><p className="clinical-help">{t("بیمار WOMAC را تکمیل نکرده است؛ پزشک می‌تواند پاسخ‌های بیمار را ثبت کند.")}</p><WOMACForm responses={responses} supplemental={supplemental} onChange={setResponses} onSupplementalChange={setSupplemental} onSave={() => void save()} onBack={() => {}} busy={busy} clinicalMode /></div>;
}
