import { t } from "../i18n";
const persianDateParts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
  year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC",
});
const tehranDateParts = new Intl.DateTimeFormat("en-US", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tehran",
});

export function todayInTehran(): string {
  const parts = tehranDateParts.formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function persianParts(date: Date) {
  const parts = persianDateParts.formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function isoDateToUtc(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

export function formatPersianDate(value?: string | null): string {
  if (!value) return t("ثبت نشده");
  return isoDateToUtc(value).toLocaleDateString("fa-IR-u-ca-persian", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

export function ageFromBirthDate(value?: string | null): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = todayInTehran().split("-").map(Number);
  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age--;
  return age >= 1 && age <= 120 ? age : null;
}

export function isoFromPersianDate(year: number, month: number, day: number): string | null {
  let low = Date.UTC(year + 620, 0, 1);
  let high = Date.UTC(year + 622, 11, 31);
  const target = year * 10000 + month * 100 + day;
  while (low <= high) {
    const mid = low + Math.floor((high - low) / 86400000 / 2) * 86400000;
    const parts = persianParts(new Date(mid));
    const value = parts.year * 10000 + parts.month * 100 + parts.day;
    if (value === target) return new Date(mid).toISOString().slice(0, 10);
    if (value < target) low = mid + 86400000;
    else high = mid - 86400000;
  }
  return null;
}
