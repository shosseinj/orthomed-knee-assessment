import { useLocale } from "../i18n";

export function Logo({ compact = false }: { compact?: boolean }) {
  const language = useLocale();
  if (language === "en" && !compact) return <span className="logo logo-wordmark"><img src="/brand/orthomed-icon-clean.svg" alt="" />Orthomed</span>;
  return <img className={compact ? "logo logo--compact" : "logo"} src={compact ? "/brand/orthomed-icon-clean.svg" : "/brand/orthomed-logo-clean.svg"} alt={language === "fa" ? "ارتومد" : "Orthomed"} />;
}
