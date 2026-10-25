import { formatDate } from "../utils/dates";
import { Activity } from "lucide-react";
import { t, locale } from "../i18n";
import type { Assessment, MedicalCase, Questionnaire } from "../types";
import { ANALGESIC_EFFECT, COMMON_CONDITIONS, COMPARTMENTS, DIABETES, HIGH_RISK, INJECTION_EFFECT, INJECTION_TIME, KNEES, NIGHT_PAIN, PT_EFFECT, PT_SESSIONS, RED_FLAGS, SMOKING, STAIRS, WALKING, WEIGHT_EFFECT, optionLabel } from "../data/previsit";

function Details({ rows }: { rows: [string, string | number | null | undefined][] }) {
  return <dl className="previsit-details">{rows.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value == null || value === "" ? t("ثبت نشده") : typeof value === "number" ? value.toLocaleString(locale()) : t(value)}</dd></div>)}</dl>;
}
const yn = (v?: boolean | null) => v == null ? "ثبت نشده" : v ? "بله" : "خیر";
function labels(options: [string, string][], values?: string[]) { return values?.map((v) => t(optionLabel(options, v))).join(t("، ")) || "ثبت نشده"; }

export function PrevisitSummary({ value: q }: { value: Questionnaire }) {
  return <div className="previsit-summary"><h4>{t("پاسخ‌های فرم پیش‌ویزیت")}</h4><Details rows={[
    ["زانوی درگیر", optionLabel(KNEES, q.affected_knee)], ["بدترین درد یک ماه اخیر (۰ تا ۱۰)", q.worst_pain_month], ["درد هنگام راه رفتن (۰ تا ۱۰)", q.walking_pain],
    ["درد شبانه", optionLabel(NIGHT_PAIN, q.night_pain_frequency)], ["توان راه رفتن بدون توقف", optionLabel(WALKING, q.walking_capacity)], ["موقع بالا رفتن از پله", optionLabel(STAIRS, q.stair_difficulty)],
    ["سختی کارهای روزمره (۰ تا ۱۰)", q.daily_activity_pain], ["اختلال خواب (۰ تا ۱۰)", q.sleep_disruption],
    ["فیزیوتراپی", optionLabel(PT_SESSIONS, q.physiotherapy_sessions)], ["اثر فیزیوتراپی", optionLabel(PT_EFFECT, q.physiotherapy_effect)],
    ...(q.had_intra_articular_injection ? [["اثر تزریق", optionLabel(INJECTION_EFFECT, q.injection_effect)], ["آخرین نوبت تزریق", optionLabel(INJECTION_TIME, q.injection_last_time)], ["سایر تزریق‌ها", q.injection_other], ["تعداد نوبت تزریق", q.injection_rounds === 0 ? "یادم نیست" : q.injection_rounds >= 3 ? "۳ نوبت یا بیشتر" : String(q.injection_rounds)]] as [string, string | undefined][] : []),
    ["مصرف مسکن", yn(q.takes_painkillers)], ...(q.takes_painkillers ? [["مسکن‌های مصرفی", q.painkillers?.map((v) => t(v === "other" ? "سایر" : v)).join(t("، "))], ["سایر مسکن‌ها", q.painkiller_other], ["پاسخ درد به مسکن‌ها", optionLabel(ANALGESIC_EFFECT, q.analgesic_effect)]] as [string, string | undefined][] : []),
    ["اقدام به کاهش وزن", yn(q.weight_loss_attempted)], ...(q.weight_loss_attempted ? [["اثر کاهش وزن بر درد زانو", optionLabel(WEIGHT_EFFECT, q.weight_loss_effect)]] as [string, string][] : []),
    ["بیماری‌های زمینه‌ای مهم", labels(COMMON_CONDITIONS, q.common_conditions)], ["یادداشت بیماری‌های زمینه‌ای", q.condition_notes], ["وضعیت دیابت", optionLabel(DIABETES, q.diabetes_status)],
    ...(q.diabetes_status !== "none" ? [["قند خون ناشتا (mg/dL)", q.fasting_glucose], ["قند سه‌ماهه HbA1c (٪)", q.hba1c]] as [string, string | null | undefined][] : []),
    ["سابقه مصرف سیگار/نیکوتین", optionLabel(SMOKING, q.smoking_status)], ...(q.smoking_status !== "never" ? [["تاریخ شروع مصرف دخانیات", formatDate(q.smoking_start_date)], ...(q.smoking_status === "former" ? [["تاریخ ترک دخانیات", formatDate(q.smoking_end_date)]] : [])] as [string, string | null | undefined][] : []),
    ["علائم هشدار", labels(RED_FLAGS, q.red_flags)], ...(q.red_flags?.includes("other") ? [["توضیح سایر علائم هشدار", q.red_flags_other]] as [string, string | undefined][] : []),
  ]} /></div>;
}
export function DoctorExaminationSummary({ value: v }: { value: Assessment }) {
  return <Details rows={[
    ["کمردرد با انتشار به زانو (رادیکولار)", yn(v.has_lower_back_pain)], ["شواهد درگیری لگن/هیپ در معاینه یا تصویربرداری", yn(v.has_hip_pain)],
    ["درد رتروپاتلا (پشت کشکک)", yn(v.retropatellar_pain)], ["فلکشن (درجه)", v.flexion_degrees], ["اکستنشن (درجه)", v.extension_degrees],
    ["ثبات رباطی", optionLabel([["stable", "پایدار"], ["unstable", "ناپایدار"]], v.ligament_stability)],
    ["محور اندام", optionLabel([["normal", "نرمال"], ["varus", "واروس"], ["valgus", "والگوس"]], v.limb_alignment)],
    ["X-ray ایستاده زانو انجام شده؟", yn(v.standing_xray)], ["درگیری کمپارتمان‌ها", labels(COMPARTMENTS, v.compartments)],
    ["عفونت فعال یا بیماری سیستمیک کنترل‌نشده", yn(v.active_infection)], ["داروهای پرریسک/شرایط ویژه", labels(HIGH_RISK, v.high_risk_conditions)],
    ["آموزش نتایج و محدودیت‌های TKA", yn(v.educated_about_tka)], ["انتظارات واقع‌بینانه بیمار", yn(v.realistic_expectations)], ["انتظارات و آمادگی بیمار", v.expectation_notes],
  ]} />;
}
export function PrevisitScoreCard({ scores }: { scores?: MedicalCase["previsit_scores"] }) {
  if (!scores) return <section className="content-card score-card"><h3>{t("امتیازهای پیش‌ویزیت A / B / C")}</h3><p>{t("برای محاسبه، فرم جدید پیش‌ویزیت باید تکمیل شده باشد.")}</p></section>;
  return <section className={`content-card score-card score-card--${scores.color}`}><header className="section-title"><span><Activity /></span><h3>{t("امتیازهای پیش‌ویزیت A / B / C")}</h3></header><div className="score-card__values">{[["A", "شدت مشکل", scores.a], ["B", "عوامل خطر پزشکی", scores.b], ["C", "فوریت/هشدار", scores.c]].map(([key, label, value]) => <div key={key}><small>{key} · {t(String(label))}</small><strong>{Number(value).toLocaleString(locale())}<small> / 100</small></strong></div>)}</div><p className="score-card__action">{t(scores.action)}</p><small>{t("محاسبه بر اساس قواعد فرم پیش‌ویزیت")}</small>{scores.risk_unknown && <p>{t("وضعیت دیابت نامشخص است؛ ارزیابی عوامل خطر نیاز به تکمیل دارد.")}</p>}{scores.other_red_flag && <p>{t("علامت هشدار «سایر» ثبت شده است؛ توضیحات بیمار را بررسی کنید.")}</p>}</section>;
}
