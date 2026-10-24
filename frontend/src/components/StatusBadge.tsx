import { t, useLocale } from "../i18n";
import type { CaseStatus } from "../types";

export function StatusBadge({ status, label }: { status: CaseStatus; label: string }) {
  useLocale();
  return <span className={`status status--${status}`}><span />{t(label)}</span>;
}
