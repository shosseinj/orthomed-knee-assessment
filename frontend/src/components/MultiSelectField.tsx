import { t, locale, useLocale, catalogLabel } from "../i18n";
import { Check, ChevronDown, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { casesApi } from "../api/client";
import type { CatalogOption } from "../types";

interface MultiSelectFieldProps {
  catalog: "diseases" | "medications";
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}

export function MultiSelectField({ catalog, label, placeholder, values, onChange }: MultiSelectFieldProps) {
  const language = useLocale();
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const loadingMoreRef = useRef(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  useEffect(() => {
    if (!open) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    setOptions([]);
    setNextOffset(null);
    setTotalCount(0);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      casesApi.searchCatalog(catalog, query, 0, controller.signal)
        .then((response) => {
          if (requestGeneration.current !== generation) return;
          setOptions(response.results);
          setNextOffset(response.next_offset);
          setTotalCount(response.count);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError") && requestGeneration.current === generation) setOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted && requestGeneration.current === generation) setLoading(false);
        });
    }, query ? 220 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [catalog, open, query, language]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const available = options.filter((option) => !values.includes(option.value));
  const loadMore = async () => {
    if (loading || loadingMoreRef.current || nextOffset === null) return;
    const generation = requestGeneration.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const response = await casesApi.searchCatalog(catalog, query, nextOffset);
      if (requestGeneration.current !== generation) return;
      setOptions((current) => {
        const known = new Set(current.map((option) => option.value));
        return [...current, ...response.results.filter((option) => !known.has(option.value))];
      });
      setNextOffset(response.next_offset);
      setTotalCount(response.count);
    } catch {
      // Keep the already loaded options visible; scrolling can retry the page.
    } finally {
      if (requestGeneration.current === generation) setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  };
  const select = (option: CatalogOption) => {
    onChange([...values, option.value]);
    setQuery("");
  };
  const addCustomDisease = () => {
    const disease = customValue.trim().replace(/\s+/g, " ");
    if (!disease || values.includes(disease)) return;
    onChange([...values, disease]);
    setCustomValue("");
    setCustomMode(false);
  };

  return <div className="field field--full multi-select-field" ref={containerRef}>
    <label htmlFor={inputId}>{label}</label>
    <div className={`multi-select ${open || customMode ? "multi-select--open" : ""}`}>
      {values.length > 0 && <div className="multi-select__chips">{values.map((value) => <span key={value}>{catalogLabel(value)}<button type="button" aria-label={t("حذف {0}", { 0: value })} onClick={() => onChange(values.filter((item) => item !== value))}><X size={14} /></button></span>)}</div>}
      <div className="multi-select__input">
        <Search size={18} />
        <input id={inputId} value={query} placeholder={values.length ? t("جست‌وجو و افزودن مورد دیگر...") : placeholder} autoComplete="off" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} aria-expanded={open} aria-controls={`${inputId}-options`} role="combobox" />
        {loading ? <LoaderCircle className="spin" size={17} /> : <ChevronDown size={18} />}
      </div>
      {catalog === "diseases" && customMode && <div className="multi-select__custom">
        <input autoFocus value={customValue} maxLength={180} placeholder={t("نام بیماری زمینه‌ای را بنویسید...")} onChange={(event) => setCustomValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomDisease(); } }} />
        <button type="button" className="multi-select__custom-add" disabled={!customValue.trim() || values.includes(customValue.trim())} onClick={addCustomDisease}><Plus size={16} />  {t("افزودن")}</button>
        <button type="button" className="multi-select__custom-cancel" aria-label={t("انصراف")} onClick={() => { setCustomMode(false); setCustomValue(""); }}><X size={16} /></button>
      </div>}
      {open && <div className="multi-select__menu" id={`${inputId}-options`} role="listbox" onScroll={(event) => { const menu = event.currentTarget; if (menu.scrollHeight - menu.scrollTop - menu.clientHeight < 90) void loadMore(); }}>
        {catalog === "diseases" && <button type="button" className="multi-select__other" onClick={() => { setCustomMode(true); setOpen(false); setQuery(""); }}><span><strong>{t("سایر")}</strong><small>{t("بیماری در فهرست نیست؟ نام آن را خودتان بنویسید.")}</small></span><Plus size={18} /></button>}
        {available.length ? available.map((option) => <button type="button" role="option" aria-selected="false" key={option.value} onClick={() => select(option)}><span><strong>{option.label}</strong>{option.secondary && <small dir="auto">{option.secondary}</small>}</span><Check size={17} /></button>) : <p>{loading ? t("در حال جست‌وجو...") : query ? t("موردی پیدا نشد.") : t("همه موارد پیشنهادی انتخاب شده‌اند.")}</p>}
        {loadingMore && <div className="multi-select__loading"><LoaderCircle className="spin" size={16} />  {t("در حال دریافت موارد بیشتر...")}</div>}
        {!loading && !loadingMore && options.length > 0 && nextOffset === null && <div className="multi-select__end">{t("همه")} {totalCount.toLocaleString(locale())}  {t("مورد نمایش داده شد.")}</div>}
      </div>}
    </div>
    <small className="multi-select__hint">{catalog === "diseases" ? t("اگر بیماری موردنظر در فهرست نبود، گزینه «سایر» را انتخاب کرده و نام آن را بنویسید.") : t("امکان انتخاب چند دارو وجود دارد؛ با نام فارسی، انگلیسی یا شرکت سازنده جست‌وجو کنید.")}</small>
  </div>;
}
