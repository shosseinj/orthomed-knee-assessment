import { t, locale, useLocale } from "../i18n";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { formatPersianDate, isoDateToUtc, isoFromPersianDate, persianParts, todayInTehran } from "../utils/dates";
import { useClearFieldError } from "./ValidatedForm";

const months = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const weekdays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const YEARS_PER_PAGE = 12;

interface BirthDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  name?: string;
}

interface DatePickerProps extends BirthDatePickerProps {
  label?: string;
  min?: string;
  max?: string;
  defaultYearOffset?: number;
}

export function BirthDatePicker(props: BirthDatePickerProps) {
  return <DatePicker {...props} label="تاریخ تولد" defaultYearOffset={40} />;
}

export function DatePicker({ value, onChange, required = false, name, label = "تاریخ", min, max, defaultYearOffset = 0 }: DatePickerProps) {
  useLocale();
  const labelId = useId();
  const clearError = useClearFieldError(name);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const todayIso = todayInTehran();
  const latestIso = max || todayIso;
  const minimumIso = min || `${Number(todayIso.slice(0, 4)) - 120}${todayIso.slice(4)}`;
  const current = persianParts(isoDateToUtc(latestIso));
  const earliest = persianParts(isoDateToUtc(minimumIso));
  const selected = value ? persianParts(isoDateToUtc(value)) : null;
  const [open, setOpen] = useState(false);
  const cursor = value ? persianParts(isoDateToUtc(value < minimumIso ? minimumIso : value > latestIso ? latestIso : value)) : {
    year: Math.max(earliest.year, current.year - defaultYearOffset), month: current.month,
  };
  if (cursor.year === earliest.year) cursor.month = Math.max(cursor.month, earliest.month);
  if (cursor.year === current.year) cursor.month = Math.min(cursor.month, current.month);
  const [year, setYear] = useState(cursor.year);
  const [month, setMonth] = useState(cursor.month);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [yearPage, setYearPage] = useState(0);
  const yearTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedYearRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (showYearPicker) selectedYearRef.current?.focus();
  }, [showYearPicker]);

  useEffect(() => {
    if (!open) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", onEscape);
      triggerRef.current?.focus();
    };
  }, [open]);

  const firstDayIso = isoFromPersianDate(year, month, 1);
  const nextMonthIso = isoFromPersianDate(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
  const daysInMonth = firstDayIso && nextMonthIso
    ? Math.round((Date.parse(nextMonthIso) - Date.parse(firstDayIso)) / 86400000)
    : 0;
  const offset = firstDayIso ? (isoDateToUtc(firstDayIso).getUTCDay() + 1) % 7 : 0;
  const earliestYear = earliest.year;
  const firstYearOnPage = current.year - yearPage * YEARS_PER_PAGE;
  const lastYearOnPage = Math.max(earliestYear, firstYearOnPage - YEARS_PER_PAGE + 1);
  const maxYearPage = Math.floor((current.year - earliestYear) / YEARS_PER_PAGE);

  function chooseYear(nextYear: number) {
    setYear(nextYear);
    if (nextYear === current.year && month > current.month) setMonth(current.month);
    if (nextYear === earliest.year && month < earliest.month) setMonth(earliest.month);
    setShowYearPicker(false);
    window.requestAnimationFrame(() => yearTriggerRef.current?.focus());
  }

  function moveMonth(delta: number) {
    setShowYearPicker(false);
    const nextMonth = month + delta;
    if (nextMonth < 1) { setYear(year - 1); setMonth(12); }
    else if (nextMonth > 12) { setYear(year + 1); setMonth(1); }
    else setMonth(nextMonth);
  }

  function chooseDay(day: number) {
    const iso = isoFromPersianDate(year, month, day);
    if (iso && iso <= latestIso && iso >= minimumIso) { onChange(iso); clearError(); setOpen(false); }
  }

  if (locale() === "en-US") return <input type="date" name={name} aria-label={t(label)} value={value} required={required} max={latestIso} min={minimumIso} onChange={(event) => onChange(event.target.value)} />;

  return <>
    <button ref={triggerRef} type="button" className={`birth-date-trigger ${value ? "birth-date-trigger--selected" : ""}`} data-date-picker data-date-value={value} data-min-date={minimumIso} data-max-date={latestIso} aria-label={t(label)} aria-haspopup="dialog" aria-required={required} onClick={() => {
      setYear(cursor.year); setMonth(cursor.month);
      setShowYearPicker(false);
      setOpen(true);
    }}><CalendarDays size={19} /><span>{value ? formatPersianDate(value) : t("انتخاب {0}", { 0: t(label) })}</span><ChevronLeft size={17} /></button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="birth-date-modal" role="dialog" aria-modal="true" aria-labelledby={labelId} onMouseDown={(event) => event.stopPropagation()}>
        <header className="birth-date-modal__header"><div><span className="eyebrow">{t("تقویم شمسی")}</span><h3 id={labelId}>{t("انتخاب {0}", { 0: t(label) })}</h3><p>{t("روز، ماه و سال شمسی را انتخاب کنید.")}</p></div><button ref={closeRef} type="button" className="birth-date-modal__close" aria-label={t("بستن تقویم")} onClick={() => setOpen(false)}><X size={19} /></button></header>
        <div className="birth-date-modal__navigation">
          <button type="button" aria-label={t("ماه قبل")} onClick={() => moveMonth(-1)} disabled={year * 12 + month <= earliest.year * 12 + earliest.month}><ChevronRight size={19} /></button>
          <select aria-label={t("ماه")} value={month} onChange={(event) => { setMonth(Number(event.target.value)); setShowYearPicker(false); }}>{months.map((name, index) => <option value={index + 1} key={name} disabled={(year === current.year && index + 1 > current.month) || (year === earliest.year && index + 1 < earliest.month)}>{name}</option>)}</select>
          <button ref={yearTriggerRef} type="button" className={`birth-date-modal__year-trigger${showYearPicker ? " active" : ""}`} aria-label={t("انتخاب سال، سال فعلی {0}", { 0: year.toLocaleString(locale(), { useGrouping: false }) })} aria-expanded={showYearPicker} onClick={() => { setYearPage(Math.floor((current.year - year) / YEARS_PER_PAGE)); setShowYearPicker((visible) => !visible); }}>{year.toLocaleString(locale(), { useGrouping: false })}<ChevronDown size={17} /></button>
          <button type="button" aria-label={t("ماه بعد")} onClick={() => moveMonth(1)} disabled={year === current.year && month === current.month}><ChevronLeft size={19} /></button>
        </div>
        {showYearPicker ? <div className="birth-date-modal__years" role="group" aria-label={t("انتخاب سال")}>
          <div className="birth-date-modal__years-heading"><span>{t("سال را انتخاب کنید")}</span><strong>{lastYearOnPage.toLocaleString(locale(), { useGrouping: false })}  {t("تا")} {firstYearOnPage.toLocaleString(locale(), { useGrouping: false })}</strong></div>
          <div className="birth-date-modal__year-grid">
            {Array.from({ length: firstYearOnPage - lastYearOnPage + 1 }, (_, index) => firstYearOnPage - index).map((option) => <button ref={option === year ? selectedYearRef : undefined} type="button" key={option} className={option === year ? "selected" : ""} aria-pressed={option === year} onClick={() => chooseYear(option)}>{option.toLocaleString(locale(), { useGrouping: false })}</button>)}
          </div>
          <div className="birth-date-modal__year-pagination"><button type="button" disabled={yearPage >= maxYearPage} onClick={() => setYearPage((page) => page + 1)}><ChevronRight size={17} />  {t("سال‌های قبل")}</button><button type="button" disabled={yearPage === 0} onClick={() => setYearPage((page) => page - 1)}>{t("سال‌های بعد")} <ChevronLeft size={17} /></button></div>
        </div> : <div className="birth-date-modal__calendar" role="grid" aria-label={`${months[month - 1]} ${year.toLocaleString(locale(), { useGrouping: false })}`}>
          {weekdays.map((name, index) => <span className="birth-date-modal__weekday" key={`${name}-${index}`}>{name}</span>)}
          {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1;
            const iso = firstDayIso ? new Date(Date.parse(firstDayIso) + index * 86400000).toISOString().slice(0, 10) : "";
            return <button type="button" role="gridcell" key={day} disabled={iso > latestIso || iso < minimumIso} aria-label={`${day.toLocaleString(locale())} ${months[month - 1]} ${year.toLocaleString(locale(), { useGrouping: false })}`} aria-selected={selected?.year === year && selected.month === month && selected.day === day} className={value === iso ? "selected" : ""} onClick={() => chooseDay(day)}>{day.toLocaleString(locale())}</button>;
          })}
        </div>}
        <footer><span>{t("تاریخ انتخاب‌شده")}</span><strong>{formatPersianDate(value)}</strong></footer>
      </section>
    </div>}
  </>;
}
