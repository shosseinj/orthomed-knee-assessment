import { createContext, useContext, useEffect, useId, useRef, useState, type SubmitEvent, type FormHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from "react";
import { t } from "../i18n";

export type FieldErrors = Record<string, string>;
const ErrorsContext = createContext<FieldErrors>({});
const ClearErrorContext = createContext<(name: string) => void>(() => {});
const requiredMessage = () => t("این قسمت را تکمیل کنید.");

export function useClearFieldError(name?: string) {
  const clear = useContext(ClearErrorContext);
  return () => { if (name) clear(name); };
}

export function focusField(form: HTMLFormElement, name: string) {
  const field = Array.from(form.querySelectorAll<HTMLElement>("[data-field]")).find((el) => el.dataset.field === name);
  const target = field || Array.from(form.elements).find((el) => el.getAttribute("name") === name) as HTMLElement | undefined;
  if (!target) return;
  for (let parent = target.parentElement; parent && parent !== form; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  const control = target.matches("input,select,textarea,button") ? target : target.querySelector<HTMLElement>('input:not([type="hidden"]),select,textarea,button');
  const focusTarget = control && getComputedStyle(control).display !== "none" ? control : target;
  if (!focusTarget.matches("input,select,textarea,button")) focusTarget.setAttribute("tabindex", "-1");
  focusTarget.focus({ preventScroll: true });
  target.scrollIntoView({ block: target.getBoundingClientRect().height > window.innerHeight - 220 ? "start" : "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

export function ValidatedForm({ children, onSubmit, errors: externalErrors, ...props }: FormHTMLAttributes<HTMLFormElement> & { errors?: FieldErrors }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => {
    if (!externalErrors || !formRef.current) return;
    setErrors(externalErrors);
    const first = Array.from(formRef.current.querySelectorAll<HTMLElement>("[data-field]")).find((el) => externalErrors[el.dataset.field || ""]);
    if (first) requestAnimationFrame(() => formRef.current && focusField(formRef.current, first.dataset.field!));
  }, [externalErrors]);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const next: FieldErrors = {};
    for (const field of form.querySelectorAll<HTMLElement>("[data-field]")) {
      const name = field.dataset.field!;
      const controls = Array.from(field.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea"));
      const invalid = controls.find((el) => !el.disabled && !el.validity.valid);
      if (invalid) {
        next[name] = invalid.validity.valueMissing ? requiredMessage() : t("مقدار واردشده معتبر نیست؛ محدوده و قالب این قسمت را بررسی کنید.");
      }
      if (field.dataset.requiredGroup === "true" && Number(field.dataset.selectionCount) === 0) next[name] = t("حداقل یک گزینه را انتخاب کنید.");
      const picker = field.querySelector<HTMLElement>("[data-date-picker]");
      if (picker) {
        const value = picker.dataset.dateValue || "";
        if (picker.getAttribute("aria-required") === "true" && !value) next[name] = requiredMessage();
        if (value && ((picker.dataset.minDate && value < picker.dataset.minDate) || (picker.dataset.maxDate && value > picker.dataset.maxDate))) next[name] = t("تاریخ انتخاب‌شده خارج از محدوده مجاز است.");
      }
    }
    setErrors(next);
    if (Object.keys(next).length) {
      event.preventDefault();
      requestAnimationFrame(() => focusField(form, Object.keys(next)[0]));
      return;
    }
    onSubmit?.(event);
  }
  return <ClearErrorContext.Provider value={(name) => setErrors((current) => { const next = { ...current }; delete next[name]; return next; })}><ErrorsContext.Provider value={errors}><form {...props} ref={formRef} noValidate onSubmit={submit} onChangeCapture={(event) => {
    const field = (event.target as HTMLElement).closest<HTMLElement>("[data-field]");
    if (field?.dataset.field) setErrors((current) => { const next = { ...current }; delete next[field.dataset.field!]; return next; });
  }}>{children}</form></ErrorsContext.Provider></ClearErrorContext.Provider>;
}

export function Field({ name, as = "label", children, requiredGroup, selectionCount, ...props }: LabelHTMLAttributes<HTMLElement> & { name: string; as?: "label" | "div" | "fieldset"; children: ReactNode; requiredGroup?: boolean; selectionCount?: number }) {
  const errors = useContext(ErrorsContext);
  const id = useId();
  const elementRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    for (const control of elementRef.current?.querySelectorAll<HTMLElement>("input,select,textarea,[data-date-picker]") || []) {
      control.setAttribute("aria-invalid", errors[name] ? "true" : "false");
      const descriptions = (control.getAttribute("aria-describedby") || "").split(" ").filter((value) => value && value !== id);
      if (errors[name]) descriptions.push(id);
      if (descriptions.length) control.setAttribute("aria-describedby", descriptions.join(" "));
      else control.removeAttribute("aria-describedby");
    }
  }, [errors, name, id, children]);
  const Tag = as;
  return <Tag {...props} ref={(node: HTMLElement | null) => { elementRef.current = node; }} data-field={name} data-required-group={requiredGroup} data-selection-count={selectionCount} className={`${props.className || "field"}${errors[name] ? " field--invalid" : ""}`} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? id : undefined} tabIndex={-1}>
    {children}{errors[name] && <span className="field-error" id={id} role="alert">{t(errors[name])}</span>}
  </Tag>;
}
