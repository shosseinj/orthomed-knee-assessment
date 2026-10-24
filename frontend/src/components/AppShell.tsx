import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { t, locale, useLocale } from "../i18n";
import { Bell, ClipboardList, LogOut, Menu, Plus, ShieldCheck, Stethoscope, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Logo } from "./Logo";

const roleLabels = { patient: "بیمار", doctor: "پزشک", insurance: "کارشناس بیمه" };

export function AppShell() {
  useLocale();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const auditAccess = user?.audit_access === true;

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!auditAccess) return;
    void authApi.recordAccess(location.pathname).catch(() => {
      // Auditing must never interrupt the clinical workflow.
    });
  }, [auditAccess, location.pathname]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  if (!user) return null;

  const handleLogout = () => { logout(); navigate("/login"); };
  return <div className="app-layout">
    <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
      <button className="icon-button sidebar__close" onClick={() => setOpen(false)} aria-label={t("بستن")}><X /></button>
      <div className="sidebar__brand"><Logo /></div>
      <nav className="sidebar__nav" onClick={() => setOpen(false)}>
        <NavLink to="/dashboard" end><ClipboardList size={20} />  {t("پرونده‌ها")}</NavLink>
        {user.role === "patient" && <NavLink to="/cases/new"><Plus size={20} />  {t("پرونده جدید")}</NavLink>}
        {user.role === "patient" && <NavLink to="/profile"><UserRound size={20} />  {t("اطلاعات من")}</NavLink>}
        {user.role === "doctor" && <span className="nav-caption"><Stethoscope size={19} />  {t("پنل پزشک")}</span>}
        {user.role === "insurance" && <span className="nav-caption"><ShieldCheck size={19} />  {t("پنل بیمه")}</span>}
      </nav>
      <button className="sidebar__logout" onClick={handleLogout}><LogOut size={19} />  {t("خروج از حساب")}</button>
    </aside>
    {open && <button className="backdrop" onClick={() => setOpen(false)} aria-label={t("بستن منو")} />}
    <main className="main">
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setOpen(true)} aria-label={t("باز کردن منو")} aria-expanded={open}><Menu /></button>
        <div className="topbar__title"><h1>{t("سامانه ارزیابی جراحی زانو")}</h1><p>{t("تصمیم‌گیری دقیق، شفاف و مستند")}</p></div>
        <div className="topbar__actions">
          <LanguageSwitcher />
          <button className="icon-button notification" aria-label={t("اعلان‌ها")}><Bell size={21} /></button>
          <div className="user-chip"><span><UserRound size={20} /></span><div><strong>{user.full_name}</strong><small>{t(roleLabels[user.role])}</small></div></div>
        </div>
      </header>
      <div className="page"><Outlet /></div>
    </main>
    <nav className="mobile-nav" aria-label={t("ناوبری اصلی")}>
      <NavLink to="/dashboard" className={({ isActive }) => isActive || location.pathname.startsWith("/cases/") && location.pathname !== "/cases/new" ? "active" : ""}><ClipboardList size={21} /><span>{t("پرونده‌ها")}</span></NavLink>
      {user.role === "patient" && <><NavLink to="/cases/new" className="mobile-nav__create"><Plus size={24} /><span>{t("پرونده جدید")}</span></NavLink><NavLink to="/profile"><UserRound size={21} /><span>{t("حساب من")}</span></NavLink></>}
      {user.role !== "patient" && <button type="button" onClick={() => setOpen(true)}><Menu size={21} /><span>{t("منو")}</span></button>}
    </nav>
  </div>;
}
