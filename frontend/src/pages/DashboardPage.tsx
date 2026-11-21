import { formatDate, formatAppointmentTime } from "../utils/dates";
import { t, locale, useLocale } from "../i18n";
import { ArrowLeft, BrainCircuit, CheckCircle2, Clock3, FileSearch, LoaderCircle, CalendarDays, RefreshCw, Search, ShieldCheck, Stethoscope, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { appointmentsApi, casesApi } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import type { Appointment, MedicalCase } from "../types";

export function DashboardPage() {
  useLocale();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [cases, setCases] = useState<MedicalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState(() => (location.state as { toast?: string } | null)?.toast || "");
  const [deleteTarget, setDeleteTarget] = useState<MedicalCase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const needsApproval = Boolean(user && user.role !== "patient" && !user.is_verified);

  useEffect(() => {
    if (needsApproval) { setLoading(false); return; }
    setLoading(true);
    casesApi.list().then((data) => setCases(data.results)).catch(() => setError(t("دریافت پرونده‌ها ممکن نشد."))).finally(() => setLoading(false));
  }, [needsApproval]);
  useEffect(() => {
    if (user?.role !== "patient") return;
    let active = true;
    const refreshAppointments = () => {
      if (document.visibilityState !== "visible") return;
      appointmentsApi.list(1, true).then((data) => { if (active) setAppointments(data.results.slice(0, 5)); }).catch(() => { if (active) setError(t("دریافت نوبت‌ها ممکن نشد.")); });
    };
    refreshAppointments();
    const interval = window.setInterval(refreshAppointments, 30000);
    window.addEventListener("focus", refreshAppointments);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", refreshAppointments); };
  }, [user?.id, user?.role]);
  const visible = useMemo(() => cases.filter((item) => `${item.patient.full_name}${item.id}`.includes(query)), [cases, query]);
  const completed = cases.filter((item) => item.status === "completed").length;
  const pending = cases.filter((item) => item.status !== "completed").length;

  async function deleteDraft() {
    if (!deleteTarget) return;
    setDeleting(true); setError("");
    try {
      await casesApi.deleteCase(deleteTarget.id);
      setCases((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null); setMessage(t("پیش‌نویس با موفقیت حذف شد."));
    } catch { setDeleteTarget(null); setError(t("حذف پیش‌نویس ممکن نشد.")); }
    finally { setDeleting(false); }
  }

  async function checkApproval() {
    setCheckingApproval(true);
    const nextUser = await refreshUser();
    if (nextUser?.is_verified) setMessage(t("حساب شما تأیید شده و پنل فعال است."));
    else setError(t("حساب هنوز توسط مدیر سامانه تأیید نشده است."));
    setCheckingApproval(false);
  }

  if (needsApproval) return <>
    <Toast message={error || message} tone={error ? "warning" : "success"} onDismiss={() => { setError(""); setMessage(""); }} />
    <section className="approval-pending"><span><ShieldCheck /></span><span className="eyebrow">{t("در انتظار تأیید مدیر")}</span><h2>{t("حساب شما هنوز فعال نشده است")}</h2><p>{t("اطلاعات حساب")} {user?.role === "doctor" ? t("پزشکی") : t("شرکت بیمه")}  {t("ثبت شده و پس از بررسی مدیر سامانه، دسترسی به پرونده‌ها فعال می‌شود.")}</p><button className="button" disabled={checkingApproval} onClick={checkApproval}>{checkingApproval ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}  {t("بررسی وضعیت تأیید")}</button></section>
  </>;

  const intro = user?.role === "patient" ? t("نوبت‌ها و پرسشنامه‌های خود را دنبال کنید.") : user?.role === "doctor" ? t("پرونده‌های آماده بررسی و نتایج ارزیابی را مدیریت کنید.") : t("سوابق تصمیم‌گیری پزشک و هوش مصنوعی را یکجا مشاهده کنید.");
  return <>
    <Toast message={error || message} tone={error ? "error" : "success"} onDismiss={() => { setError(""); setMessage(""); if (location.state) navigate(location.pathname, { replace: true, state: null }); }} />
    <section className="page-heading"><div><span className="eyebrow">{t(user?.role === "patient" ? "پنل بیمار" : user?.role === "doctor" ? "پنل پزشک" : "پنل بیمه")}</span><h2>{t("سلام،")} {user?.first_name || t("همراه ارتومد")}</h2><p>{intro}</p></div>{(user?.role === "patient" || user?.role === "doctor") && <Link className="button" to="/appointments"><CalendarDays size={19} />{t(user.role === "doctor" ? "ثبت نوبت" : "نوبت‌های من")}</Link>}</section>
    {user?.role === "patient" && <section className="content-card patient-appointments"><header className="card-header"><h3>{t("نوبت‌ها و پرسشنامه‌ها")}</h3><Link to="/appointments">{t("همه نوبت‌ها")}</Link></header>{appointments.length ? appointments.map((appointment) => <article className="appointment-row" key={appointment.id}><div><strong>{appointment.doctor.full_name}</strong><p>{formatAppointmentTime(appointment.scheduled_at)}</p></div>{appointment.case_id && <Link className="button button--secondary" to={`/cases/${appointment.case_id}`}>{t("تکمیل پرسشنامه")}</Link>}</article>) : <p>{t("برای شروع، QR پزشک را اسکن کنید یا از پزشک بخواهید برای شما نوبت ثبت کند.")}</p>}</section>}
    <section className="stats-grid">
      <article className="stat-card"><span className="stat-card__icon mint"><FileSearch /></span><div><small>{t("همه پرونده‌ها")}</small><strong>{cases.length.toLocaleString(locale())}</strong></div><span className="stat-card__meta">{t("ثبت‌شده")}</span></article>
      <article className="stat-card"><span className="stat-card__icon amber"><Clock3 /></span><div><small>{t("در انتظار بررسی")}</small><strong>{pending.toLocaleString(locale())}</strong></div><span className="stat-card__meta">{t("فعال")}</span></article>
      <article className="stat-card"><span className="stat-card__icon blue"><CheckCircle2 /></span><div><small>{t("تکمیل‌شده")}</small><strong>{completed.toLocaleString(locale())}</strong></div><span className="stat-card__meta">{t("نهایی")}</span></article>
    </section>
    <section className="content-card cases-card">
      <header className="card-header"><div><h3>{t("پرونده‌ها")}</h3><p>{user?.role === "patient" ? t("تمام ارزیابی‌های ثبت‌شده شما") : t("پرونده‌های ارسال‌شده بیماران")}</p></div><label className="search"><Search size={18} /><input placeholder={t("جست‌وجوی بیمار یا کد پرونده")} value={query} onChange={(e) => setQuery(e.target.value)} /></label></header>
      {loading ? <div className="skeleton-list"><i /><i /><i /></div> : visible.length === 0 ? <EmptyState canCreate={false} onCreate={() => navigate("/appointments")} /> : <div className="case-list">
        {visible.map((item) => <div className="case-row" role="button" tabIndex={0} key={item.id} onClick={() => navigate(`/cases/${item.id}`)} onKeyDown={(event) => { if (event.currentTarget === event.target && event.key === "Enter") navigate(`/cases/${item.id}`); }}>
          <span className="case-row__avatar">{item.patient.first_name?.[0] || t("ل")}{item.patient.last_name?.[0] || t("م")}</span>
          <span className="case-row__main"><strong>{user?.role === "patient" ? t(item.title) : item.patient.full_name}</strong><small>{t("کد")} {item.id.slice(0, 8).toUpperCase()} · {formatDate(item.created_at)}</small></span>
          {user?.role !== "patient" && <span className="case-row__signals"><span className={item.has_ai_assessment ? "done" : ""}><BrainCircuit size={16} /> AI</span><span className={item.has_doctor_assessment ? "done" : ""}><Stethoscope size={16} />  {t("پزشک")}</span></span>}
          <StatusBadge status={item.status} label={item.status_label} /><span className="case-row__actions">{item.can_delete_draft && item.status === "draft" && <button type="button" className="row-delete" aria-label={t("حذف پیش‌نویس")} onClick={(event) => { event.stopPropagation(); setDeleteTarget(item); }}><Trash2 size={17} /></button>}<ArrowLeft className="case-row__arrow" size={20} /></span>
        </div>)}
      </div>}
    </section>
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={() => !deleting && setDeleteTarget(null)}><section className="confirm-modal confirm-modal--danger" role="dialog" aria-modal="true" aria-labelledby="dashboard-delete-title" onMouseDown={(event) => event.stopPropagation()}><span className="confirm-modal__icon"><Trash2 /></span><span className="eyebrow">{t("حذف پیش‌نویس")}</span><h3 id="dashboard-delete-title">{t("پرونده «")}{deleteTarget.title}{t("» حذف شود؟")}</h3><p>{t("تمام پاسخ‌ها و تصاویر این پیش‌نویس برای همیشه حذف خواهند شد.")}</p><div className="confirm-modal__actions"><button className="button button--ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>{t("انصراف")}</button><button className="button button--danger" disabled={deleting} onClick={deleteDraft}>{deleting ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}  {t("حذف پیش‌نویس")}</button></div></section></div>}
  </>;
}
