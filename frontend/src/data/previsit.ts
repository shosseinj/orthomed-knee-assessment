export const PAINKILLERS = ["دیکلوفناک", "ناپروکسن", "ملوکسیکام", "استامینوفن", "فاروکسی فن", "گاباپنتین", "پره گابالین", "other"];
export const COMMON_CONDITIONS: [string, string][] = [
  ["diabetes", "دیابت"], ["cardiovascular", "بیماری قلب و عروق (سکته قلبی، آنژین، نارسایی قلب یا گرفتگی عروق)"],
  ["hypertension", "فشار خون کنترل‌نشده"], ["stroke", "سابقه سکته مغزی (CVA/TIA)"],
  ["peripheral_vascular", "بیماری عروق محیطی (گرفتگی عروق پا)"], ["pulmonary", "بیماری ریوی مهم (COPD یا آسم شدید)"],
  ["renal", "بیماری کلیوی مهم"], ["inflammatory_arthritis", "بیماری التهابی مفاصل (مثل روماتیسم مفصلی)"],
  ["parkinsons", "پارکینسون"], ["neurological", "مشکلات عصبی/حرکتی مهم دیگر (MS، صرع یا ضعف عضلانی پایدار)"], ["none", "هیچ‌کدام"],
];
export const RED_FLAGS: [string, string][] = [
  ["fever", "تب/لرز همراه درد زانو"], ["hot_swollen", "زانوی خیلی داغ/قرمز با ورم شدید"],
  ["unable_to_bear_weight", "ناتوانی ناگهانی در تحمل وزن یا راه رفتن"], ["wound", "زخم باز/ترشح نزدیک زانو (به‌خصوص پس از جراحی)"],
  ["other", "سایر"], ["none", "هیچ‌کدام"],
];
export const HIGH_RISK: [string, string][] = [["anticoagulants", "ضدانعقاد"], ["long_term_steroids", "کورتون طولانی‌مدت"], ["immunosuppression", "سرکوب ایمنی"], ["dvt_pe", "سابقه DVT/PE"], ["none", "هیچ‌کدام"]];
export const COMPARTMENTS: [string, string][] = [["medial", "مدیال"], ["lateral", "لترال"], ["patellofemoral", "پاتلوفمورال"], ["multiple", "چندکمپارتمانی"]];
export const WALKING: [string, string][] = [["under_2", "کمتر از ۲ دقیقه (کمتر از ۱۰۰ متر)"], ["2_to_5", "۲ تا ۵ دقیقه (۱۰۰ تا ۳۰۰ متر)"], ["5_to_10", "۵ تا ۱۰ دقیقه (۳۰۰ تا ۸۰۰ متر)"], ["over_10", "بیشتر از ۱۰ دقیقه (بیش از ۸۰۰ متر)"]];
export const STAIRS: [string, string][] = [["none", "بدون مشکل"], ["pain", "با درد"], ["support", "فقط با کمک/نرده"], ["unable", "نمی‌توانم"]];
export const PT_SESSIONS: [string, string][] = [["none", "انجام نداده‌ام"], ["under_10", "کمتر از ۱۰ جلسه"], ["10_plus", "۱۰ جلسه یا بیشتر"]];
export const PT_EFFECT: [string, string][] = [["not_tried", "انجام نداده‌ام"], ["none", "بی‌اثر"], ["partial", "کمی بهتر"], ["good", "خوب"]];
export const INJECTION_EFFECT: [string, string][] = [["good", "بهبود قابل توجه"], ["temporary", "موقت"], ["none", "بدون پاسخ"]];
export const INJECTION_TIME: [string, string][] = [["under_1", "کمتر از ۱ ماه پیش"], ["1_to_3", "۱ تا ۳ ماه پیش"], ["3_to_6", "۳ تا ۶ ماه پیش"], ["over_6", "بیشتر از ۶ ماه پیش"], ["unknown", "یادم نیست"]];
export const ANALGESIC_EFFECT: [string, string][] = [["none", "اصلاً"], ["low", "کم"], ["moderate", "متوسط"], ["high", "زیاد"]];
export const WEIGHT_EFFECT: [string, string][] = [["none", "خیر"], ["partial", "تا حدودی"], ["good", "بله به مقدار زیاد"]];
export const NIGHT_PAIN: [string, string][] = [["none", "ندارم"], ["sometimes", "گاهی"], ["often", "اغلب"]];
export const DIABETES: [string, string][] = [["none", "ندارم"], ["controlled", "دارم و در کنترل است"], ["uncontrolled", "دارم و در کنترل نیست"], ["unknown", "اطلاع ندارم"]];
export const SMOKING: [string, string][] = [["never", "خیر"], ["former", "قبلاً (ترک کرده‌ام)"], ["current", "فعال (گاهی/روزانه)"]];
export const KNEES: [string, string][] = [["right", "راست"], ["left", "چپ"], ["both", "هر دو"]];
export const YES_NO: [string, string][] = [["yes", "بله"], ["no", "خیر"]];

export interface PrevisitAnswers {
  intake_version?: string;
  affected_knee?: string;
  worst_pain_month?: number | null;
  walking_pain?: number | null;
  night_pain_frequency?: string;
  walking_capacity?: string;
  stair_difficulty?: string;
  daily_activity_pain?: number | null;
  sleep_disruption?: number | null;
  physiotherapy_sessions?: string;
  physiotherapy_effect?: string;
  injection_other?: string;
  injection_effect?: string;
  injection_last_time?: string;
  takes_painkillers?: boolean | null;
  painkillers?: string[];
  painkiller_other?: string;
  analgesic_effect?: string;
  weight_loss_attempted?: boolean | null;
  weight_loss_effect?: string;
  common_conditions?: string[];
  condition_notes?: string;
  fasting_glucose?: string | null;
  hba1c?: string | null;
  smoking_start_date?: string | null;
  smoking_end_date?: string | null;
  red_flags?: string[];
  red_flags_other?: string;
}
export interface DoctorExamination {
  retropatellar_pain?: boolean | null;
  flexion_degrees?: number | null;
  extension_degrees?: number | null;
  ligament_stability?: string;
  limb_alignment?: string;
  standing_xray?: boolean | null;
  compartments?: string[];
  active_infection?: boolean | null;
  high_risk_conditions?: string[];
  educated_about_tka?: boolean | null;
  realistic_expectations?: boolean | null;
}
export function optionLabel(options: [string, string][], value?: string) { return options.find(([key]) => key === value)?.[1] || "ثبت نشده"; }
