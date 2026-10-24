import { useSyncExternalStore } from "react";
import english from "./en.json";

export type Language = "en" | "fa";
const STORAGE_KEY = "orthomed_language";
const listeners = new Set<() => void>();
function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fa") return saved;
  } catch { /* Language selection still works when storage is unavailable. */ }
  return navigator.language.toLowerCase().startsWith("fa") ? "fa" : "en";
}
let language = initialLanguage();

export function getLanguage(): Language { return language; }
export function locale(): string { return language === "fa" ? "fa-IR" : "en-US"; }
export function t(key: string, params: Record<string, unknown> = {}): string {
  const translated = language === "en" ? (english as Record<string, string>)[key] ?? key : key;
  return translated.replace(/\{(\w+)\}/g, (token, name) => String(params[name] ?? token));
}
function updateDocument() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
  document.title = language === "fa" ? "ارتومد | ارزیابی جراحی زانو" : "Orthomed | Knee surgery assessment";
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("سامانه ارزیابی جراحی زانو"));
}
export function setLanguage(next: Language) {
  language = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the in-memory preference. */ }
  updateDocument();
  listeners.forEach((listener) => listener());
}
export function useLocale(): Language {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, getLanguage);
}
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY && (event.newValue === "en" || event.newValue === "fa")) setLanguage(event.newValue);
});
updateDocument();

// Catalog values remain unchanged in storage; only their presentation is localized.
export function catalogLabel(value: string): string {
  if (language === "fa") return value;
  const parts = value.split(" — ");
  return parts.length > 1 ? parts.slice(1).join(" — ") : t(value);
}
