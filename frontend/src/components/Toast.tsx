import { t, useLocale } from "../i18n";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ToastTone = "success" | "error" | "warning" | "info";

const titles: Record<ToastTone, string> = {
  success: "عملیات موفق",
  error: "خطا",
  warning: "توجه",
  info: "اطلاع‌رسانی",
};

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function Toast({ message, tone = "info", onDismiss, duration = 4500 }: { message: string; tone?: ToastTone; onDismiss: () => void; duration?: number }) {
  useLocale();
  const dismissRef = useRef(onDismiss);
  const exitTimer = useRef<number | null>(null);
  const dismissTimer = useRef<number | null>(null);
  const [exiting, setExiting] = useState(false);
  dismissRef.current = onDismiss;

  function clearTimers() {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
  }

  useEffect(() => {
    if (!message) return;
    setExiting(false);
    const fadeDuration = Math.min(240, duration);
    exitTimer.current = window.setTimeout(() => setExiting(true), Math.max(0, duration - fadeDuration));
    dismissTimer.current = window.setTimeout(() => dismissRef.current(), duration);
    return clearTimers;
  }, [duration, message, tone]);

  function dismiss() {
    clearTimers();
    setExiting(true);
    dismissTimer.current = window.setTimeout(() => dismissRef.current(), 240);
  }

  if (!message) return null;
  const Icon = icons[tone];
  return createPortal(<aside className={`toast toast--${tone}${exiting ? " toast--exiting" : ""}`} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
    <span className="toast__icon"><Icon size={21} /></span>
    <div className="toast__copy"><strong>{t(titles[tone])}</strong><p>{t(message)}</p></div>
    <button type="button" className="toast__close" aria-label={t("بستن پیام")} onClick={dismiss}><X size={17} /></button>
    <i className="toast__timer" style={{ animationDuration: `${duration}ms` }} />
  </aside>, document.body);
}
