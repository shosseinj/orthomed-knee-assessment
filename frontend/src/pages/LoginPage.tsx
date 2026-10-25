import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { t, locale, useLocale } from "../i18n";
import { ArrowLeft, Check, LockKeyhole, Phone, RotateCcw, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, apiErrorMessage, authApi } from "../api/client";
import { BirthDatePicker } from "../components/BirthDatePicker";
import { Logo } from "../components/Logo";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";
import { isValidNationalCode, normalizeNationalCode } from "../utils/nationalCode";

type Step = "phone" | "signup" | "otp";

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
  const [role, setRole] = useState<Role>("patient");
  const [medicalCouncilNumber, setMedicalCouncilNumber] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [isMock, setIsMock] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState("");
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
    setRole("patient"); setMedicalCouncilNumber(""); setOrganizationName("");
  }

  async function requestOtp(event?: FormEvent) {
    event?.preventDefault();
    setError(""); setLoading(true);
    try {
      const result = await authApi.requestOtp(phone);
      setIsMock(result.is_mock);
      setDevelopmentCode(result.development_code || "");
      setCode(""); setRegistrationToken("");
      setStep("otp"); setSeconds(120);
    } catch (err) {
      setError(apiErrorMessage(err, "ارسال کد تأیید ممکن نشد. کمی بعد دوباره تلاش کنید."));
    } finally { setLoading(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const result = await authApi.verifyOtp({ phone_number: phone, code });
      setCode("");
      if (result.registration_required) {
        setRegistrationToken(result.registration_token);
        setStep("signup");
        return;
      }
      login(result.access, result.refresh, result.user);
      navigate(result.user.can_manage_accounts ? "/management" : "/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err, "ورود ممکن نشد. کد تأیید را بررسی کنید."));
    } finally { setLoading(false); }
  }

  async function register(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const result = await authApi.register({
        registration_token: registrationToken,
        first_name: firstName, last_name: lastName,
        national_code: normalizeNationalCode(nationalCode), birth_date: birthDate,
        role, medical_council_number: medicalCouncilNumber, organization_name: organizationName,
      });
      setRegistrationToken("");
      login(result.access, result.refresh, result.user);
      navigate(result.user.can_manage_accounts ? "/management" : "/dashboard");
    } catch (err) {
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
        <span className="auth-visual__icon"><img src="/brand/orthomed-icon-clean.svg" alt="" /></span>
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
          <div className="auth-card__heading"><h2>{t("ورود یا ثبت‌نام")}</h2><p>{t("برای ادامه، شماره موبایل خود را وارد کنید.")}</p></div>
          <form onSubmit={requestOtp}>
            <label className="field"><span>{t("شماره موبایل")}</span><div className="input-wrap"><Phone size={20} /><input dir="ltr" inputMode="numeric" autoFocus placeholder="0912 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></div></label>
            <button className="button button--wide" disabled={phone.length < 11 || loading}>{loading ? t("در حال ارسال...") : <>{t("ادامه")} <ArrowLeft size={19} /></>}</button>
          </form>
        </> : step === "signup" ? <>
          <button className="text-button auth-back" disabled={loading} onClick={changePhone}>{t("تغییر شماره")}</button>
          <div className="auth-card__heading"><h2>{t("ساخت حساب کاربری")}</h2><p>{t("این شماره هنوز در ارتومد ثبت نشده است. اطلاعات خود را تکمیل کنید.")}</p></div>
          <form onSubmit={register}>
            <div className="signup-phone"><Phone size={17} /><span dir="ltr">{phone}</span></div>
            <div className="split-fields signup-fields"><label className="field"><span>{t("نام")}</span><input autoFocus required placeholder={t("مثلاً محمد")} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label><label className="field"><span>{t("نام خانوادگی")}</span><input required placeholder={t("مثلاً رضایی")} value={lastName} onChange={(e) => setLastName(e.target.value)} /></label></div>
            <label className="field"><span>{t("کد ملی")} <b className="required-mark">*</b></span><input dir="ltr" inputMode="numeric" autoComplete="off" maxLength={10} required placeholder={t("۱۰ رقم کد ملی")} value={nationalCode} onChange={(e) => setNationalCode(normalizeNationalCode(e.target.value).replace(/\D/g, "").slice(0, 10))} />{nationalCode.length === 10 && !isValidNationalCode(nationalCode) && <small className="input-error">{t("رقم کنترل کد ملی معتبر نیست.")}</small>}</label>
            <div className="field"><span>{t("تاریخ تولد")} <b className="required-mark">*</b></span><BirthDatePicker value={birthDate} onChange={setBirthDate} required /><small className="field-help">{t("تاریخ را از تقویم شمسی انتخاب کنید.")}</small></div>
            <div className="field"><span>{t("نوع حساب")}</span><div className="role-pills"><button type="button" className={role === "patient" ? "active" : ""} onClick={() => setRole("patient")}>{t("بیمار")}</button><button type="button" className={role === "doctor" ? "active" : ""} onClick={() => setRole("doctor")}>{t("پزشک")}</button><button type="button" className={role === "insurance" ? "active" : ""} onClick={() => setRole("insurance")}>{t("شرکت بیمه")}</button></div>{role !== "patient" && <small className="role-note">{t("حساب")} {role === "doctor" ? t("پزشک") : t("بیمه")}  {t("پس از بررسی و تأیید مدیر سامانه فعال می‌شود.")}</small>}</div>
            {role === "doctor" && <label className="field"><span>{t("شماره نظام پزشکی")}</span><input required placeholder={t("مثلاً ۱۲۳۴۵۶")} value={medicalCouncilNumber} onChange={(e) => setMedicalCouncilNumber(e.target.value)} /></label>}
            {role === "insurance" && <label className="field"><span>{t("نام شرکت یا سازمان بیمه")}</span><input required placeholder={t("مثلاً بیمه سلامت")} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} /></label>}
            <button className="button button--wide" disabled={!registrationToken || !firstName.trim() || !lastName.trim() || !isValidNationalCode(nationalCode) || !birthDate || (role === "doctor" && !medicalCouncilNumber.trim()) || (role === "insurance" && !organizationName.trim()) || loading}>{loading ? t("در حال بررسی...") : <>{t("ثبت‌نام و ورود")} <ArrowLeft size={19} /></>}</button>
          </form>
        </> : <>
          <button className="text-button auth-back" disabled={loading} onClick={changePhone}>{t("تغییر شماره")}</button>
          <div className="auth-card__heading"><span className="otp-icon"><LockKeyhole /></span><h2>{t("تأیید شماره موبایل")}</h2><p>{isMock ? <>{t("در حالت توسعه، کد")} <b dir="ltr">{developmentCode}</b>  {t("را وارد کنید.")}</> : <>{t("کد پنج‌رقمی به شماره")} <b dir="ltr">{phone}</b>  {t("ارسال شد.")}</>}</p></div>
          <form onSubmit={verify}>
            <label className="field"><span>{t("کد تأیید")}</span><input className="otp-input" dir="ltr" inputMode="numeric" maxLength={5} autoFocus placeholder="— — — — —" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
            <button className="button button--wide" disabled={code.length !== 5 || loading}>{loading ? t("در حال بررسی...") : t("تأیید و ادامه")}</button>
            <button type="button" className="resend" disabled={seconds > 0 || loading} onClick={() => requestOtp()}><RotateCcw size={15} />{seconds ? t("ارسال مجدد تا {0} ثانیه", { 0: seconds }) : t("ارسال مجدد کد")}</button>
          </form>
        </>}
        <p className="auth-footnote"><ShieldCheck size={15} />  {t("اطلاعات شما به‌صورت امن نگهداری می‌شود.")}</p>
      </div>
    </section>
  </main>;
}
