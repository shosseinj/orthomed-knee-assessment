import { formatDate } from "../utils/dates";
import { Field, ValidatedForm } from "../components/ValidatedForm";
import { t, useLocale } from "../i18n";
import { CalendarDays, Fingerprint, LockKeyhole, Save, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError, apiFieldErrors, authApi } from "../api/client";
import { BirthDatePicker } from "../components/BirthDatePicker";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";

export function ProfilePage() {
  useLocale();
  const { user, refreshUser } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [birthDate, setBirthDate] = useState(user?.birth_date ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setFirstName(user.first_name);
    setLastName(user.last_name);
    setBirthDate(user.birth_date ?? "");
  }, [user]);

  if (!user) return <Navigate to="/dashboard" replace />;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !birthDate) {
      setFieldErrors({ ...(!firstName.trim() ? { first_name: t("این قسمت را تکمیل کنید.") } : {}), ...(!lastName.trim() ? { last_name: t("این قسمت را تکمیل کنید.") } : {}), ...(!birthDate ? { birth_date: t("این قسمت را تکمیل کنید.") } : {}) });
      setError(t("نام، نام خانوادگی و تاریخ تولد را کامل کنید."));
      return;
    }
    setBusy(true); setFieldErrors({}); setError(""); setMessage("");
    try {
      await authApi.updateProfile({ first_name: firstName.trim(), last_name: lastName.trim(), birth_date: birthDate });
      await refreshUser();
      setMessage(t("اطلاعات پروفایل با موفقیت ذخیره شد."));
    } catch (err) {
      setFieldErrors(apiFieldErrors(err));
      const errors = err instanceof ApiError ? (err.body as { errors?: Record<string, string[] | string> })?.errors : undefined;
      const detail = errors?.birth_date ?? errors?.first_name ?? errors?.last_name;
      setError(Array.isArray(detail) ? t(detail[0]) : typeof detail === "string" ? t(detail) : t("ذخیره اطلاعات ممکن نشد. دوباره تلاش کنید."));
    } finally { setBusy(false); }
  }

  return <>
    <Toast message={error || message} tone={error ? "error" : "success"} onDismiss={() => { setError(""); setMessage(""); }} />
    <header className="page-heading"><div><span className="eyebrow">{t("حساب کاربری")}</span><h2>{t("اطلاعات من")}</h2><p>{t(user.role === "patient" ? "نام و تاریخ تولد خود را در این صفحه ویرایش کنید." : "مشخصات و اطلاعات حساب خود را در این صفحه مشاهده کنید.")}</p></div></header>
    <div className="profile-layout">
      <section className="content-card profile-card"><header className="section-title"><span><UserRound /></span><div><h3>{t("مشخصات فردی")}</h3><p>{t("این اطلاعات در پرونده‌های شما نمایش داده می‌شود.")}</p></div></header>
        {user.role === "patient" ? <ValidatedForm errors={fieldErrors} onSubmit={save}>
          <div className="split-fields"><Field name="first_name" className="field"><span>{t("نام")} <b className="required-mark">*</b></span><input required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field><Field name="last_name" className="field"><span>{t("نام خانوادگی")} <b className="required-mark">*</b></span><input required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field></div>
          <Field as="div" name="birth_date" className="field"><span>{t("تاریخ تولد")} <b className="required-mark">*</b></span><BirthDatePicker name="birth_date" value={birthDate} onChange={setBirthDate} required /><small className="field-help">{t("سن پرسش‌نامه‌های جدید از این تاریخ پیشنهاد می‌شود و همچنان قابل ویرایش است.")}</small></Field>
          <button className="button" disabled={busy}><Save size={18} />{busy ? t("در حال ذخیره...") : t("ذخیره تغییرات")}</button>
        </ValidatedForm> : <dl className="previsit-details">
          <div><dt>{t("نام")}</dt><dd>{user.first_name || t("ثبت نشده")}</dd></div>
          <div><dt>{t("نام خانوادگی")}</dt><dd>{user.last_name || t("ثبت نشده")}</dd></div>
          <div><dt>{t("تاریخ تولد")}</dt><dd>{formatDate(user.birth_date)}</dd></div>
          <div><dt>{t("نوع حساب")}</dt><dd>{t(user.role === "doctor" ? "پزشک" : "کارشناس بیمه")}</dd></div>
          {user.role === "doctor" && <div><dt>{t("شماره نظام پزشکی")}</dt><dd>{user.medical_council_number || t("ثبت نشده")}</dd></div>}
          {user.role === "insurance" && <div><dt>{t("نام شرکت یا سازمان بیمه")}</dt><dd>{user.organization_name || t("ثبت نشده")}</dd></div>}
        </dl>}
      </section>
      <aside className="content-card profile-locked"><span className="profile-locked__icon"><LockKeyhole /></span><h3>{t("اطلاعات ثابت حساب")}</h3><p>{t("شماره موبایل و کد ملی در این بخش قابل ویرایش نیستند.")}</p><div><span><Fingerprint size={17} />  {t("کد ملی")}</span><strong dir="ltr">{user.national_code || t("ثبت نشده")}</strong></div><div><span><CalendarDays size={17} />  {t("شماره موبایل")}</span><strong dir="ltr">{user.phone_number}</strong></div></aside>
    </div>
  </>;
}
