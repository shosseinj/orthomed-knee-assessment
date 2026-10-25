import { useId } from "react";
import { Field } from "./ValidatedForm";
import { Check } from "lucide-react";
import { locale, t } from "../i18n";

export function SelectField({ label, value, options, onChange, required = false, name }: { label: string; value?: string; options: [string, string][]; onChange: (v: string) => void; required?: boolean; name?: string }) {
  const id = useId();
  return <Field name={name || id} className="field"><span>{t(label)} {required && <b className="required-mark">*</b>}</span><select name={name} value={value || ""} required={required} onChange={(e) => onChange(e.target.value)}><option value="">{t("انتخاب کنید")}</option>{options.map(([key, text]) => <option key={key} value={key}>{t(text)}</option>)}</select></Field>;
}
export function ScoreField({ label, value, onChange, name }: { label: string; value?: number | null; onChange: (v: number) => void; name?: string }) {
  const id = useId();
  return <Field as="fieldset" name={name || id} className="field field--full score-field"><legend>{t(label)} <b className="required-mark">*</b></legend><div className="score-options">{Array.from({ length: 11 }, (_, n) => <label key={n} className={value === n ? "active" : ""}><input type="radio" name={name || id} required value={n} checked={value === n} onChange={() => onChange(n)} /><span>{n.toLocaleString(locale())}</span></label>)}</div><div className="range-labels"><small>{t("صفر: هیچ / بدون درد")}</small><small>{t("۱۰: بیشترین شدت")}</small></div></Field>;
}
export function Choices({ label, values, options, onChange, name, required = false }: { label: string; values: string[]; options: [string, string][]; onChange: (v: string[]) => void; name?: string; required?: boolean }) {
  const id = useId();
  return <Field as="fieldset" name={name || id} requiredGroup={required} selectionCount={values.length} className="field field--full"><legend>{t(label)}</legend><div className="choice-grid">{options.map(([key, text]) => <label className="choice" key={key}><input type="checkbox" checked={values.includes(key)} onChange={() => onChange(values.includes(key) ? values.filter((v) => v !== key) : key === "none" ? ["none"] : [...values.filter((v) => v !== "none"), key])} /><span><Check size={14} /></span>{t(text)}</label>)}</div></Field>;
}
export function FormSection({ title }: { title: string }) { return <h4 className="intake-section field--full">{t(title)}</h4>; }
