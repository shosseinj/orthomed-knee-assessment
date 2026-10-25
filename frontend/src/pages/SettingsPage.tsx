import { Field, ValidatedForm } from "../components/ValidatedForm";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, Save, Settings, Trash2 } from "lucide-react";
import { apiErrorMessage, apiFieldErrors, authApi } from "../api/client";
import { Toast } from "../components/Toast";
import { t, useLocale } from "../i18n";
import type { AISettingsStatus } from "../types";

export function SettingsPage() {
  useLocale();
  const [status, setStatus] = useState<AISettingsStatus | null>(null);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    authApi.aiSettings().then((data) => { if (active) setStatus(data); })
      .catch((e) => { if (active) setError(apiErrorMessage(e, "دریافت تنظیمات ممکن نشد. دوباره تلاش کنید.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setFieldErrors({}); setError(""); setMessage("");
    try {
      setStatus(await authApi.saveAiSettings(key.trim()));
      setKey(""); setVisible(false);
      setMessage(t("کلید ذخیره شد. درخواست بعدی هوش مصنوعی از این کلید استفاده می‌کند."));
    } catch (e) { setFieldErrors(apiFieldErrors(e)); setError(apiErrorMessage(e, "ذخیره کلید ممکن نشد. دوباره تلاش کنید.")); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setFieldErrors({}); setError(""); setMessage("");
    try {
      setStatus(await authApi.removeAiKey());
      setKey(""); setVisible(false);
      setMessage(t("کلید شخصی شما حذف شد."));
    } catch (e) { setError(apiErrorMessage(e, "حذف کلید ممکن نشد. دوباره تلاش کنید.")); }
    finally { setBusy(false); }
  }

  return <>
    <Toast message={error || message} tone={error ? "error" : "success"} onDismiss={() => { setError(""); setMessage(""); }} />
    <header className="page-heading"><div><span className="eyebrow">{t("حساب کاربری")}</span><h2>{t("تنظیمات")}</h2><p>{t("اتصال حساب خود به سرویس هوش مصنوعی را مدیریت کنید.")}</p></div></header>
    <section className="content-card ai-settings-card">
      <header className="section-title"><span><Settings /></span><div><h3>{t("تنظیمات هوش مصنوعی")}</h3><p>{t("کلید OpenAI خود را برای تحلیل پرونده‌ها وارد کنید.")}</p></div></header>
      <div className="ai-key-status" role="status">{loading ? <><LoaderCircle className="spin" size={18} /> {t("در حال دریافت تنظیمات...")}</> : <><KeyRound size={19} /><span>{status?.has_api_key ? <>{t("کلید شخصی ذخیره شده است")} <b dir="ltr">••••{status.key_last_four}</b></> : status?.server_key_configured ? t("کلید سرور فعال است؛ می‌توانید کلید شخصی خود را جایگزین کنید.") : status ? t("هنوز کلیدی تنظیم نشده است.") : t("وضعیت کلید در دسترس نیست؛ می‌توانید کلید خود را وارد کنید.")}</span></>}</div>
      <ValidatedForm errors={fieldErrors} onSubmit={save}>
        <Field as="div" name="openai_api_key" className="field">
        <label className="field" htmlFor="openai-api-key"><span>OPENAI_API_KEY</span></label>
        <div className="ai-key-input">
          <input id="openai-api-key" type={visible ? "text" : "password"} value={key} required minLength={20} maxLength={512} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" placeholder="sk-…" disabled={busy || loading} onChange={(event) => setKey(event.target.value)} aria-describedby="ai-key-help" />
          <button type="button" className="icon-button" onClick={() => setVisible(!visible)} disabled={busy || loading} aria-label={t(visible ? "پنهان کردن کلید" : "نمایش کلید")} aria-pressed={visible}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
        </div>
        </Field>
        <p className="field-help" id="ai-key-help">{t("کلید به‌صورت رمزگذاری‌شده برای حساب شما ذخیره می‌شود. فقط چهار نویسه پایانی نمایش داده می‌شود.")}</p>
        <p className="field-help">{t("ذخیره کلید به‌معنای تأیید اعتبار آن نیست؛ اعتبار و دسترسی هنگام درخواست تحلیل بررسی می‌شود.")}</p>
        <div className="ai-key-actions"><button className="button" type="submit" disabled={busy || loading}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}{t(status?.has_api_key ? "جایگزینی کلید" : "ذخیره کلید")}</button>{status?.has_api_key && <button className="button button--secondary" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={18} />{t("حذف کلید شخصی")}</button>}</div>
      </ValidatedForm>
      <p className="ai-key-footer"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">{t("دریافت کلید از OpenAI")}</a></p>
    </section>
  </>;
}
