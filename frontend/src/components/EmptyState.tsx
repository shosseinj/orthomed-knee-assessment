import { t, useLocale } from "../i18n";
import { ClipboardPlus } from "lucide-react";

export function EmptyState({ onCreate, canCreate }: { onCreate?: () => void; canCreate?: boolean }) {
  useLocale();
  return <div className="empty-state">
    <span className="empty-state__icon"><ClipboardPlus size={30} /></span>
    <h3>{t("هنوز پرونده‌ای اینجا نیست")}</h3>
    <p>{canCreate ? t("برای شروع ارزیابی، اولین پرونده خود را ایجاد کنید.") : t("پرونده‌های جدید پس از ثبت بیمار در این بخش نمایش داده می‌شوند.")}</p>
    {canCreate && <button className="button" onClick={onCreate}>{t("ایجاد پرونده جدید")}</button>}
  </div>;
}
