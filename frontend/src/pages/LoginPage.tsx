import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { t, useLocale } from "../i18n";
import { ArrowLeft, Check, LockKeyhole, Phone, RotateCcw, ShieldCheck, Stethoscope, Building2, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, apiErrorMessage, authApi } from "../api/client";
import { BirthDatePicker } from "../components/BirthDatePicker";
import { Logo } from "../components/Logo";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import type { Role, User } from "../types";
import { isValidNationalCode, normalizeNationalCode } from "../utils/nationalCode";

type Step = "phone" | "signup" | "otp";
type EntryRole = Role | "admin";
const entryRoles = [
  { value: "patient", label: "بیمار", icon: UserRound },
  { value: "doctor", label: "پزشک", icon: Stethoscope },
  { value: "insurance", label: "شرکت بیمه", icon: Building2 },
  { value: "admin", label: "ادمین", icon: ShieldCheck },
] as const;

export function LoginPage() {
  useLocale();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nationalCode, setNationalCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [role, setRole] = useState<EntryRole | null>(null);
  const [medicalCouncilNumber, setMedicalCouncilNumber] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [registrationProfile, setRegistrationProfile] = useState<Partial<User> | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [isMock, setIsMock] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState("");
  const [manualCodeEnabled, setManualCodeEnabled] = useState(false);
  const [smsSent, setSmsSent] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!seconds) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(value - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  if (user) return <Navigate to={user.can_manage_accounts ? "/management" : "/dashboard"} replace />;

  function changePhone() {
    setStep("phone"); setRegistrationToken(""); setCode(""); setError(""); setSeconds(0);
    setFirstName(""); setLastName(""); setNationalCode(""); setBirthDate("");
    setMedicalCouncilNumber(""); setOrganizationName("");
    setRegistrationProfile(null);
    setAdminPassword("");
  }

  async function requestOtp(event?: FormEvent) {
    event?.preventDefault();
    if (!role) return;
    setError(""); setLoading(true);
    try {
      const result = await authApi.requestOtp(phone);
      setIsMock(result.is_mock);
      setDevelopmentCode(result.development_code || "");
      setManualCodeEnabled(Boolean(result.manual_code_enabled));
      setSmsSent(result.sms_sent !== false);
      setCode(""); setRegistrationToken("");
      setStep("otp"); setSeconds(120);
    } catch (err) {
      setError(apiErrorMessage(err, "ارسال کد تأیید ممکن نشد. کمی بعد دوباره تلاش کنید."));
    } finally { setLoading(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      if (!role) return;
      const result = await authApi.verifyOtp({ phone_number: phone, code, entry_role: role });
      setCode("");
      if (result.registration_required) {
        setRegistrationToken(result.registration_token);
        setRegistrationProfile(result.registration_profile || null);
        setFirstName(result.registration_profile?.first_name || "");
        setLastName(result.registration_profile?.last_name || "");
        setNationalCode(result.registration_profile?.national_code || "");
        setBirthDate(result.registration_profile?.birth_date || "");
        setStep("signup");
        return;
      }
      login(result.access, result.refresh, result.user);
      navigate(result.user.can_manage_accounts ? "/management" : "/dashboard");
    } catch (err) {
      if (err instanceof ApiError && (err.body as { errors?: Record<string, unknown> })?.errors?.entry_role) {
        setStep("phone"); setCode(""); setRegistrationToken(""); setSeconds(0);
      }
      setError(apiErrorMessage(err, "ورود ممکن نشد. کد تأیید را بررسی کنید."));
    } finally { setLoading(false); }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (!role) return;
    setError(""); setLoading(true);
    try {
      const result = await authApi.register({
        registration_token: registrationToken,
        first_name: firstName, last_name: lastName,
        national_code: normalizeNationalCode(nationalCode), birth_date: birthDate,
        role, medical_council_number: medicalCouncilNumber, organization_name: organizationName,
        ...(role === "admin" ? { admin_password: adminPassword } : {}),
      });
      setRegistrationToken("");
      setAdminPassword("");
      login(result.access, result.refresh, result.user);
      navigate(result.user.can_manage_accounts ? "/management" : "/dashboard");
    } catch (err) {
      setAdminPassword("");
      if (err instanceof ApiError && (err.body as { errors?: Record<string, unknown> })?.errors?.registration_token) {
        setStep("phone"); setRegistrationToken("");
      }
      setError(apiErrorMessage(err, "ثبت‌نام ممکن نشد. اطلاعات را بررسی کنید."));
    } finally { setLoading(false); }
  }

  return <main className="auth-page">
    <Toast message={error} tone="error" onDismiss={() => setError("")} />
    <section className="auth-visual">
      <div className="auth-visual__content">
        <span className="auth-visual__brand"><Logo /></span>
        <h1>{t("تصمیم بهتر، درمان مطمئن‌تر")}</h1>
        <p>{t("ارزیابی یکپارچه تصاویر رادیولوژی و علائم بالینی برای تصمیم‌گیری شفاف درباره جراحی زانو.")}</p>
        <div className="trust-row"><span><ShieldCheck size={18} />  {t("حفاظت از داده پزشکی")}</span><span><Check size={18} />  {t("بررسی پزشک متخصص")}</span></div>
      </div>
      <div className="visual-orb visual-orb--one" /><div className="visual-orb visual-orb--two" />
    </section>
    <section className="auth-panel">
      <LanguageSwitcher />
      <div className="auth-card">
        <Logo />
        {step === "phone" ? <>
          <div className="auth-card__heading"><h2>{t("ورود یا ثبت‌نام")}</h2><p>{t("نوع ورود را انتخاب کنید، سپس شماره موبایل خود را وارد کنید.")}</p></div>
          <form onSubmit={requestOtp}>
            <fieldset className="entry-roles" disabled={loading}><legend>{t("نوع ورود")}</legend><div className="entry-roles__grid">{entryRoles.map(({ value, label, icon: Icon }) => <label key={value} className={`entry-role ${role === value ? "entry-role--selected" : ""}`}><input type="radio" name="entry_role" value={value} checked={role === value} onChange={() => { setRole(value); setError(""); }} required /><Icon size={23} aria-hidden="true" /><span>{t(label)}</span></label>)}</div></fieldset>
            {role === "admin" && <p className="field-help">{t("برای ساخت حساب ادمین، رمز ثبت‌نام مدیر لازم است.")}</p>}
            <label className="field"><span>{t("شماره موبایل")}</span><div className="input-wrap"><Phone size={20} /><input dir="ltr" inputMode="numeric" autoComplete="tel" disabled={!role || loading} placeholder="0912 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></div></label>
            <button className="button button--wide" disabled={!role || phone.length < 11 || loading}>{loading ? t("در حال ارسال...") : <>{t("ادامه")} <ArrowLeft size={19} /></>}</button>
          </form>
        </> : step === "signup" ? <>
          <button className="text-button auth-back" disabled={loading} onClick={changePhone}>{t("تغییر نوع ورود یا شماره")}</button>
          <div className="auth-card__heading"><h2>{t("ساخت حساب کاربری")}</h2><p>{t("برای این نوع حساب هنوز ثبت‌نام نکرده‌اید. اطلاعات این نقش را تکمیل کنید.")}</p></div>
          <form onSubmit={register}>
            {registrationProfile && <p className="field-help">{t("هویت شما قبلاً ثبت شده است؛ ثبت‌نام این نقش مستقل است.")}</p>}
            <div className="signup-phone"><Phone size={17} /><span dir="ltr">{phone}</span></div>
            <div className="split-fields signup-fields"><label className="field"><span>{t("نام")}</span><input autoFocus required readOnly={Boolean(registrationProfile?.first_name)} placeholder={t("مثلاً محمد")} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label><label className="field"><span>{t("نام خانوادگی")}</span><input required readOnly={Boolean(registrationProfile?.last_name)} placeholder={t("مثلاً رضایی")} value={lastName} onChange={(e) => setLastName(e.target.value)} /></label></div>
            <label className="field"><span>{t("کد ملی")} <b className="required-mark">*</b></span><input dir="ltr" inputMode="numeric" autoComplete="off" maxLength={10} required readOnly={Boolean(registrationProfile?.national_code)} placeholder={t("۱۰ رقم کد ملی")} value={nationalCode} onChange={(e) => setNationalCode(normalizeNationalCode(e.target.value).replace(/\D/g, "").slice(0, 10))} />{nationalCode.length === 10 && !isValidNationalCode(nationalCode) && <small className="input-error">{t("رقم کنترل کد ملی معتبر نیست.")}</small>}</label>
            <div className="field"><span>{t("تاریخ تولد")} <b className="required-mark">*</b></span><BirthDatePicker value={birthDate} onChange={setBirthDate} required disabled={Boolean(registrationProfile?.birth_date)} /><small className="field-help">{t("تاریخ را از تقویم شمسی انتخاب کنید.")}</small></div>
            <div className="field"><span>{t("نوع حساب")}: <strong>{t(entryRoles.find((item) => item.value === role)?.label || "")}</strong></span>{(role === "doctor" || role === "insurance") && <small className="role-note">{t("حساب")} {role === "doctor" ? t("پزشک") : t("بیمه")}  {t("پس از بررسی و تأیید مدیر سامانه فعال می‌شود.")}</small>}</div>
            {role === "doctor" && <label className="field"><span>{t("شماره نظام پزشکی")}</span><input required placeholder={t("مثلاً ۱۲۳۴۵۶")} value={medicalCouncilNumber} onChange={(e) => setMedicalCouncilNumber(e.target.value)} /></label>}
            {role === "insurance" && <label className="field"><span>{t("نام شرکت یا سازمان بیمه")}</span><input required placeholder={t("مثلاً بیمه سلامت")} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} /></label>}
            {role === "admin" && <label className="field"><span>{t("رمز ثبت‌نام ادمین")}</span><input type="password" dir="ltr" autoComplete="off" required maxLength={128} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} /></label>}
            <button className="button button--wide" disabled={!registrationToken || !firstName.trim() || !lastName.trim() || !isValidNationalCode(nationalCode) || !birthDate || (role === "doctor" && !medicalCouncilNumber.trim()) || (role === "insurance" && !organizationName.trim()) || (role === "admin" && !adminPassword) || loading}>{loading ? t("در حال بررسی...") : <>{t("ثبت‌نام و ورود")} <ArrowLeft size={19} /></>}</button>
          </form>
        </> : <>
          <button className="text-button auth-back" disabled={loading} onClick={changePhone}>{t("تغییر نوع ورود یا شماره")}</button>
          <div className="auth-card__heading"><span className="otp-icon"><LockKeyhole /></span><h2>{t("تأیید شماره موبایل")}</h2><p>{isMock ? <>{t("در حالت توسعه، کد")} <b dir="ltr">{developmentCode}</b>  {t("را وارد کنید.")}</> : smsSent ? <>{t("کد پنج‌رقمی به شماره")} <b dir="ltr">{phone}</b>  {t("ارسال شد.")}</> : t("ارسال پیامک انجام نشد؛ کد ورود دستی را وارد کنید یا دوباره درخواست پیامک بدهید.")}</p></div>
          <form onSubmit={verify}>
            <p className="signup-phone">{t("نوع ورود")}: {t(entryRoles.find((item) => item.value === role)?.label || "")}</p>
            <label className="field"><span>{t("کد تأیید")}</span><input className="otp-input" dir="ltr" inputMode="numeric" maxLength={5} autoFocus placeholder="— — — — —" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
            {manualCodeEnabled && !isMock && <p className="field-help">{t("اگر پیامک دریافت نکردید، می‌توانید کد ورود دستی را در همین کادر وارد کنید.")}</p>}
            <button className="button button--wide" disabled={code.length !== 5 || loading}>{loading ? t("در حال بررسی...") : t("تأیید و ادامه")}</button>
            <button type="button" className="resend" disabled={seconds > 0 || loading} onClick={() => requestOtp()}><RotateCcw size={15} />{seconds ? t("ارسال مجدد تا {0} ثانیه", { 0: seconds }) : t("ارسال مجدد کد")}</button>
          </form>
        </>}
        <p className="auth-footnote"><ShieldCheck size={15} />  {t("اطلاعات شما به‌صورت امن نگهداری می‌شود.")}</p>
      </div>
    </section>
  </main>;
}
