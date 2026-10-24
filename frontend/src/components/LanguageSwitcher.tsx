import { Languages } from "lucide-react";
import { setLanguage, useLocale } from "../i18n";

export function LanguageSwitcher() {
  const language = useLocale();
  return <div className="language-switcher" role="group" aria-label={language === "fa" ? "زبان" : "Language"}>
    <Languages size={17} aria-hidden="true" />
    <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
    <button type="button" lang="fa" aria-pressed={language === "fa"} onClick={() => setLanguage("fa")}>فارسی</button>
  </div>;
}
