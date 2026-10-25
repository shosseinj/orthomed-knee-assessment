import { useEffect, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, LoaderCircle, RefreshCw, Search, ShieldCheck, ShieldX, Stethoscope, Users } from "lucide-react";
import { apiErrorMessage, authApi } from "../api/client";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { locale, t, useLocale } from "../i18n";
import type { ManagedAccount, ManagedAccountList } from "../types";
import { formatDate } from "../utils/dates";

export function AccountManagementPage() {
  useLocale();
  const { user } = useAuth();
  const allowed = Boolean(user?.can_manage_accounts);
  const [data, setData] = useState<ManagedAccountList | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [target, setTarget] = useState<ManagedAccount | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(query.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ q: search, role, status, page: String(page) });
    authApi.managedAccounts(params, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => { if (!controller.signal.aborted) { setData(null); setError(apiErrorMessage(e, "دریافت فهرست حساب‌ها ممکن نشد. دوباره تلاش کنید.")); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, search, role, status, page, revision]);
  useEffect(() => {
    if (!target || busyId) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setTarget(null); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [target, busyId]);

  async function review(account: ManagedAccount, verified: boolean) {
    setBusyId(account.id); setError(""); setMessage("");
    try {
      await authApi.reviewAccount(account.id, verified);
      setTarget(null);
      setMessage(t(verified ? "حساب {0} تأیید و فعال شد." : "تأیید حساب {0} لغو شد.", { 0: account.full_name }));
      // Returning to the first page also avoids an empty last page after removal.
      setPage(1); setRevision((value) => value + 1);
    } catch (e) { setError(apiErrorMessage(e, "تغییر وضعیت حساب ممکن نشد. دوباره تلاش کنید.")); }
    finally { setBusyId(""); }
  }

  if (!allowed) return <section className="content-card manager-denied"><ShieldX size={38} /><h2>{t("دسترسی مدیر لازم است")}</h2><p>{t("این صفحه فقط برای حساب دارای دسترسی مدیر سامانه قابل استفاده است.")}</p></section>;

  const summary = data?.summary;
  return <>
    <Toast message={error || message} tone={error ? "error" : "success"} onDismiss={() => { setError(""); setMessage(""); }} />
    <header className="page-heading"><div><span className="eyebrow">{t("مدیر سامانه")}</span><h2>{t("مدیریت حساب‌ها")}</h2><p>{t("حساب پزشکان و کارشناسان بیمه را بررسی و فعال کنید.")}</p></div><button type="button" className="button button--secondary" disabled={loading || Boolean(busyId)} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={18} />{t("به‌روزرسانی فهرست")}</button></header>
    <div className="manager-stats">
      {[["total", "همه حساب‌ها", Users], ["pending", "در انتظار تأیید", Clock3], ["verified", "تأیید و فعال", CheckCircle2], ["inactive", "حساب غیرفعال", ShieldX]].map(([key, label, Icon]) => {
        const StatIcon = Icon as typeof Users;
        return <div className={`content-card manager-stat manager-stat--${key}`} key={String(key)}><StatIcon size={22} /><div><small>{t(String(label))}</small><strong>{summary ? summary[key as keyof typeof summary].toLocaleString(locale()) : "—"}</strong></div></div>;
      })}
    </div>
    <section className="content-card manager-content">
      <div className="manager-filters"><label className="field manager-search"><span>{t("جست‌وجوی حساب")}</span><div className="manager-search__input"><Search size={18} /><input value={query} maxLength={120} disabled={Boolean(busyId)} onChange={(event) => setQuery(event.target.value)} placeholder={t("نام، موبایل، کد ملی یا شماره نظام پزشکی...")} /></div></label>
        <label className="field"><span>{t("نوع حساب")}</span><select value={role} disabled={Boolean(busyId)} onChange={(event) => { setRole(event.target.value); setPage(1); }}><option value="">{t("پزشک و کارشناس بیمه")}</option><option value="doctor">{t("پزشک")}</option><option value="insurance">{t("کارشناس بیمه")}</option></select></label>
        <label className="field"><span>{t("وضعیت حساب")}</span><select value={status} disabled={Boolean(busyId)} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="pending">{t("در انتظار تأیید")}</option><option value="verified">{t("تأیید و فعال")}</option><option value="inactive">{t("حساب غیرفعال")}</option><option value="all">{t("همه وضعیت‌ها")}</option></select></label>
      </div>
      <p className="manager-hint"><ShieldCheck size={17} />{t("تأیید حساب، دسترسی متناسب با نقش پزشک یا بیمه را فعال می‌کند. این صفحه دسترسی مدیر اعطا نمی‌کند.")}</p>
      {loading ? <div className="manager-loading" role="status"><LoaderCircle className="spin" />{t("در حال دریافت حساب‌ها...")}</div> : error && !data ? <div className="manager-empty"><p>{t("فهرست حساب‌ها بارگذاری نشد.")}</p><button className="button button--secondary" onClick={() => setRevision((value) => value + 1)}>{t("تلاش دوباره")}</button></div> : data?.results.length ? <div className="manager-accounts">{data.results.map((account) => {
        const approved = account.is_verified && account.is_active;
        return <article className="managed-account" key={account.id}>
          <header><span className="managed-account__icon">{account.role === "doctor" ? <Stethoscope /> : <ShieldCheck />}</span><div><h3>{account.full_name}</h3><p>{t(account.role === "doctor" ? "پزشک" : "کارشناس بیمه")}</p></div><span className={`managed-account__status ${approved ? "approved" : "pending"}`}>{t(!account.is_active ? "حساب غیرفعال" : approved ? "تأیید و فعال" : "در انتظار تأیید")}</span></header>
          <dl><div><dt>{t("شماره موبایل")}</dt><dd dir="ltr">{account.phone_number}</dd></div><div><dt>{t("کد ملی")}</dt><dd dir="ltr">{account.national_code || t("ثبت نشده")}</dd></div>{account.role === "doctor" ? <div><dt>{t("شماره نظام پزشکی")}</dt><dd>{account.medical_council_number || t("ثبت نشده")}</dd></div> : <div><dt>{t("نام شرکت یا سازمان بیمه")}</dt><dd>{account.organization_name || t("ثبت نشده")}</dd></div>}<div><dt>{t("تاریخ ثبت‌نام")}</dt><dd>{formatDate(account.date_joined)}</dd></div></dl>
          <footer><button className={`button ${approved ? "button--secondary" : ""}`} type="button" disabled={Boolean(busyId)} onClick={() => approved ? setTarget(account) : void review(account, true)} aria-label={t(approved ? "لغو تأیید {0}" : "تأیید و فعال‌سازی {0}", { 0: account.full_name })}>{busyId === account.id ? <LoaderCircle className="spin" size={18} /> : approved ? <ShieldX size={18} /> : <CheckCircle2 size={18} />}{t(approved ? "لغو تأیید" : "تأیید و فعال‌سازی")}</button></footer>
        </article>;
      })}</div> : <div className="manager-empty"><ShieldCheck size={34} /><h3>{t(status === "pending" && !search && !role ? "حسابی در انتظار تأیید نیست" : "حسابی با این شرایط پیدا نشد")}</h3><p>{t("برای مشاهده سایر حساب‌ها، جست‌وجو یا فیلتر وضعیت را تغییر دهید.")}</p></div>}
      {data && !loading && <footer className="manager-pagination"><span>{t("{0} حساب", { 0: data.count.toLocaleString(locale()) })}</span><div><button className="button button--ghost" disabled={!data.previous || Boolean(busyId)} onClick={() => setPage((value) => value - 1)}><ChevronRight size={17} />{t("صفحه قبل")}</button><span>{page.toLocaleString(locale())}</span><button className="button button--ghost" disabled={!data.next || Boolean(busyId)} onClick={() => setPage((value) => value + 1)}>{t("صفحه بعد")}<ChevronLeft size={17} /></button></div></footer>}
    </section>
    {target && <div className="modal-backdrop" role="presentation" onMouseDown={() => !busyId && setTarget(null)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="revoke-account-title" onMouseDown={(event) => event.stopPropagation()}><span className="confirm-modal__icon"><ShieldX /></span><h3 id="revoke-account-title">{t("تأیید این حساب لغو شود؟")}</h3><p>{target.full_name} · <span dir="ltr">{target.phone_number}</span></p><p>{t("پس از لغو تأیید، دسترسی حرفه‌ای این حساب به پرونده‌ها متوقف می‌شود. حساب و سوابق ثبت‌شده حذف نمی‌شوند.")}</p><div className="confirm-modal__actions"><button className="button button--secondary" disabled={Boolean(busyId)} onClick={() => setTarget(null)}>{t("انصراف")}</button><button className="button" disabled={Boolean(busyId)} onClick={() => void review(target, false)}>{busyId ? <LoaderCircle className="spin" size={18} /> : <ShieldX size={18} />}{t("لغو تأیید")}</button></div></section></div>}
  </>;
}
