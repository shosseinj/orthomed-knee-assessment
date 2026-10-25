import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { t, useLocale } from "../i18n";
import { Bell, ClipboardList, LogOut, Menu, Plus, Settings, ShieldCheck, Stethoscope, UserRound, X } from "lucide-react";
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
        {user.can_manage_accounts && <NavLink to="/management"><ShieldCheck size={20} /> {t("مدیر سامانه")}</NavLink>}
        <NavLink to="/dashboard" end><ClipboardList size={20} />  {t("پرونده‌ها")}</NavLink>
        {user.role === "patient" && <NavLink to="/cases/new"><Plus size={20} />  {t("پرونده جدید")}</NavLink>}
        <NavLink to="/settings"><Settings size={20} /> {t("تنظیمات")}</NavLink>
        {user.role === "doctor" && <span className="nav-caption"><Stethoscope size={19} />  {t("پنل پزشک")}</span>}
        {user.role === "insurance" && <span className="nav-caption"><ShieldCheck size={19} />  {t("پنل بیمه")}</span>}
      </nav>
      <div className="sidebar__footer">
        <NavLink to="/profile" className="sidebar__user" onClick={() => setOpen(false)} aria-label={t("مشاهده اطلاعات حساب {0}", { 0: user.full_name })}>
          <span className="sidebar__avatar"><UserRound size={22} /></span><div><strong>{user.full_name}</strong><small>{t(user.can_manage_accounts ? "مدیر سامانه" : roleLabels[user.role])}</small></div>
        </NavLink>
        <button className="sidebar__logout" type="button" onClick={handleLogout}><LogOut size={19} /> {t("خروج از حساب")}</button>
      </div>
    </aside>
    {open && <button className="backdrop" onClick={() => setOpen(false)} aria-label={t("بستن منو")} />}
    <main className="main">
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setOpen(true)} aria-label={t("باز کردن منو")} aria-expanded={open}><Menu /></button>
        <div className="topbar__actions">
          <LanguageSwitcher />
          <button className="icon-button notification" aria-label={t("اعلان‌ها")}><Bell size={21} /></button>
        </div>
      </header>
      <div className="page"><Outlet /></div>
    </main>
    <nav className="mobile-nav" aria-label={t("ناوبری اصلی")}>
      {user.can_manage_accounts && <NavLink to="/management"><ShieldCheck size={21} /><span>{t("مدیریت")}</span></NavLink>}
      <NavLink to="/dashboard" className={({ isActive }) => isActive || location.pathname.startsWith("/cases/") && location.pathname !== "/cases/new" ? "active" : ""}><ClipboardList size={21} /><span>{t("پرونده‌ها")}</span></NavLink>
      {user.role === "patient" && <NavLink to="/cases/new" className="mobile-nav__create"><Plus size={24} /><span>{t("پرونده جدید")}</span></NavLink>}
      <NavLink to="/settings"><Settings size={21} /><span>{t("تنظیمات")}</span></NavLink>
      {user.role !== "patient" && <button type="button" onClick={() => setOpen(true)}><Menu size={21} /><span>{t("منو")}</span></button>}
    </nav>
  </div>;
}
