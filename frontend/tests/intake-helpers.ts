import type { Page } from "@playwright/test";
export async function fillPrevisit(page: Page) {
  await page.getByLabel("Affected knee", { exact: false }).selectOption("both");
  await page.locator("#pain-duration").fill("60");
  for (const name of ["Worst pain in the past month (0–10)", "Pain while walking (0–10)", "Difficulty with daily activities due to knee pain (0–10)", "Sleep disruption due to knee pain (0–10)"]) {
    await page.getByRole("group").filter({ has: page.locator("legend", { hasText: name }) }).locator('input[value="0"]').check();
  }
  await page.getByLabel("Night pain", { exact: false }).selectOption("none");
  await page.getByLabel("On a typical day, how long can you walk without stopping or sitting?", { exact: false }).selectOption("over_10");
  await page.getByLabel("When climbing stairs", { exact: false }).selectOption("none");
  await page.getByLabel("Physiotherapy", { exact: false }).first().selectOption("10_plus");
  await page.getByLabel("Effect of physiotherapy", { exact: false }).selectOption("none");
  await page.getByLabel("Do you take painkillers for knee pain?", { exact: false }).selectOption("no");
  await page.getByLabel("Have you tried losing weight to reduce knee pain?", { exact: false }).selectOption("no");
  await page.getByRole("group").filter({ has: page.locator("legend", { hasText: "Major underlying conditions" }) }).getByText("None", { exact: false }).click();
  await page.getByRole("group").filter({ has: page.locator("legend", { hasText: "Warning signs" }) }).getByText("None", { exact: false }).click();
}

export async function choosePersianDate(page: Page, label: string, year: number, month: number, day: number) {
  const fa = (value: number) => value.toLocaleString("fa-IR", { useGrouping: false });
  const months = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.locator(".birth-date-modal__year-trigger").click();
  const yearButton = page.locator(".birth-date-modal__year-grid").getByRole("button", { name: fa(year), exact: true });
  for (let n = 0; n < 11 && await yearButton.count() === 0; n++) await page.getByRole("button", { name: "سال‌های قبل", exact: true }).click();
  await yearButton.click();
  await page.getByRole("combobox", { name: "ماه", exact: true }).selectOption(String(month));
  await page.getByRole("gridcell", { name: `${fa(day)} ${months[month - 1]} ${fa(year)}`, exact: true }).click();
}
