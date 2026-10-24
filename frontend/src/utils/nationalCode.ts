const easternDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

export function normalizeNationalCode(value: string): string {
  return value.trim().replace(/[۰-۹٠-٩]/g, (digit) => String(Math.max(easternDigits.indexOf(digit), arabicDigits.indexOf(digit))));
}

export function isValidNationalCode(value: string): boolean {
  const code = normalizeNationalCode(value);
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const remainder = [...code.slice(0, 9)].reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0) % 11;
  return Number(code[9]) === (remainder < 2 ? remainder : 11 - remainder);
}
