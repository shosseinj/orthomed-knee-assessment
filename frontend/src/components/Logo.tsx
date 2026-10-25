import { useLocale } from "../i18n";

export function Logo({ compact = false }: { compact?: boolean }) {
  const language = useLocale();
  return <img className={compact ? "logo logo--compact" : "logo"} src="/brand/orthomed-logo.png" alt={language === "fa" ? "ارتومد" : "Orthomed"} />;
}
