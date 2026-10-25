import { expect, test, type Page } from "@playwright/test";

const doctor = { id: "doctor-1", full_name: "حسین محمدی", first_name: "حسین", last_name: "محمدی", role: "doctor", phone_number: "09123456789", national_code: "0013520822", medical_council_number: "123456", is_verified: false, is_active: true, date_joined: "2026-10-25T12:00:00Z" };
const insurer = { ...doctor, id: "insurance-1", role: "insurance", full_name: "بیمه نمونه", first_name: "سارا", last_name: "احمدی", phone_number: "09121112233", organization_name: "بیمه نمونه", is_verified: true };
async function session(page: Page, { allowed = true, fail = false } = {}) {
  await page.addInitScript(() => { localStorage.setItem("orthomed_access", "test-token"); localStorage.setItem("orthomed_language", "fa"); });
  let accounts = [{ ...doctor }, { ...insurer }];
  const calls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname.endsWith("/auth/me/")) return route.fulfill({ json: { id: "manager-1", role: allowed ? "patient" : "doctor", first_name: "مدیر", last_name: "سامانه", full_name: "مدیر سامانه", can_manage_accounts: allowed, is_verified: allowed } });
    if (url.pathname.includes("/management/accounts/")) {
      calls.push(req.method());
      if (req.method() === "PATCH") {
        if (fail) return route.fulfill({ status: 403, json: { errors: { detail: "فقط مدیر سامانه اجازه مدیریت تأیید حساب‌ها را دارد." } } });
        const id = url.pathname.split("/").filter(Boolean).at(-1);
        const value = req.postDataJSON();
        expect(Object.keys(value)).toEqual(["is_verified"]);
        accounts = accounts.map((item) => item.id === id ? { ...item, is_verified: value.is_verified, is_active: value.is_verified ? true : item.is_active } : item);
        return route.fulfill({ json: accounts.find((item) => item.id === id) });
      }
      const status = url.searchParams.get("status"); const role = url.searchParams.get("role"); const search = url.searchParams.get("q");
      const rows = accounts.filter((item) => (!role || role === item.role) && (!search || `${item.full_name}${item.phone_number}${item.medical_council_number}`.includes(search)) && (status === "all" || status === "pending" && !item.is_verified || status === "verified" && item.is_verified));
      return route.fulfill({ json: { results: rows, count: rows.length, next: null, previous: null, summary: { total: accounts.length, pending: accounts.filter((item) => !item.is_verified).length, verified: accounts.filter((item) => item.is_verified).length, inactive: 0 } } });
    }
    return route.fulfill({ json: { results: [], count: 0 } });
  });
  return calls;
}

test("manager approves a doctor then can revoke clinical access", async ({ page }) => {
  await session(page);
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "مدیریت حساب‌ها", exact: true })).toBeVisible();
  await expect(page.locator(".managed-account")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: doctor.full_name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `تأیید و فعال‌سازی ${doctor.full_name}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "حسابی در انتظار تأیید نیست", exact: true })).toBeVisible();
  await expect(page.getByText(`حساب ${doctor.full_name} تأیید و فعال شد.`, { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "وضعیت حساب", exact: true }).selectOption("verified");
  await expect(page.locator(".managed-account")).toHaveCount(2);
  await page.getByRole("button", { name: `لغو تأیید ${doctor.full_name}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(doctor.phone_number);
  await dialog.getByRole("button", { name: "لغو تأیید", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("combobox", { name: "وضعیت حساب", exact: true }).selectOption("pending");
  await expect(page.getByRole("button", { name: `تأیید و فعال‌سازی ${doctor.full_name}`, exact: true })).toBeVisible();
});

test("ordinary doctor cannot see management links or load account list", async ({ page }) => {
  const calls = await session(page, { allowed: false });
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "دسترسی مدیر لازم است", exact: true })).toBeVisible();
  await expect(page.locator('.sidebar__nav a[href="/management"]')).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("failed approval leaves account pending and reports error", async ({ page }) => {
  await session(page, { fail: true });
  await page.goto("/management");
  await page.getByRole("button", { name: `تأیید و فعال‌سازی ${doctor.full_name}`, exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("فقط مدیر سامانه");
  await expect(page.getByRole("button", { name: `تأیید و فعال‌سازی ${doctor.full_name}`, exact: true })).toBeEnabled();
  await expect(page.getByText(`حساب ${doctor.full_name} تأیید و فعال شد.`, { exact: true })).toHaveCount(0);
});

test("management filters, Persian dates and English mobile layout work", async ({ page }) => {
  await session(page);
  await page.goto("/management");
  await expect(page.locator(".managed-account")).toContainText("۱۴۰۵");
  await page.screenshot({ path: "/tmp/orthomed-management-fa.png", fullPage: true });
  await page.getByRole("combobox", { name: "وضعیت حساب", exact: true }).selectOption("all");
  await page.getByRole("combobox", { name: "نوع حساب", exact: true }).selectOption("insurance");
  await expect(page.locator(".managed-account")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: insurer.full_name, exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "نوع حساب", exact: true }).selectOption("");
  await page.getByRole("textbox", { name: "جست‌وجوی حساب", exact: true }).fill(doctor.phone_number);
  await expect(page.locator(".managed-account")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: doctor.full_name, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account management", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
