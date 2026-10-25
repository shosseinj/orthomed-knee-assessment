import { fillPrevisit } from "./intake-helpers";
import { expect, test, type Page } from "@playwright/test";

const user = { id: "test-user", phone_number: "09501234567", first_name: "Alex", last_name: "Patient", full_name: "Alex Patient", national_code: "0013520822", birth_date: "1985-04-20", role: "patient", is_verified: true };
const medicalCase = { id: "12345678-1234-1234-1234-123456789012", title: "ارزیابی جراحی زانو", patient: user, status: "draft", status_label: "پیش‌نویس", can_edit_intake: true, image_count: 0, created_at: "2026-10-24T12:00:00Z", images: [], assessments: [] };
async function signedIn(page: Page, role = "patient") {
  await page.addInitScript(() => {
    localStorage.setItem("orthomed_access", "test-token");
    if (!localStorage.getItem("orthomed_language")) localStorage.setItem("orthomed_language", "en");
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    const body = url.endsWith("/auth/me/") ? { ...user, role } : url.includes("/catalogs/") ? { results: [], count: 0, next_offset: null } : /\/cases\/[0-9a-f-]+\/$/.test(url) ? medicalCase : { results: [medicalCase], count: 1, next: null };
    await route.fulfill({ json: body });
  });
}

test("language switching updates direction and persists after reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ورود یا ثبت‌نام" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
});

test("switching languages preserves intake answers and canonical medical values", async ({ page }) => {
  await signedIn(page);
  await page.goto(`/cases/${medicalCase.id}`);
  await expect(page.getByRole("heading", { name: "Medical and treatment history" })).toBeVisible();
  await page.locator('input[type="number"]').nth(0).fill("67");
  await page.locator("select").nth(0).selectOption("female");
  await page.locator('input[type="number"]').nth(1).fill("170");
  await page.locator('input[type="number"]').nth(2).fill("75");
  await fillPrevisit(page);
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await expect(page.getByLabel("فیزیوتراپی", { exact: false }).first()).toHaveValue("10_plus");
  await expect(page.locator('input[type="number"]').nth(0)).toHaveValue("67");
  await page.getByRole("button", { name: "English", exact: true }).click();
  const request = page.waitForRequest((request) => request.url().endsWith("/questionnaire/") && request.method() === "PUT");
  await page.getByRole("button", { name: "Save and continue" }).click();
  expect((await request).postDataJSON()).toMatchObject({ age_years: 67, gender: "female", previous_treatments: ["فیزیوتراپی"] });
});

test("English Gregorian and Persian calendars retain the same birth date", async ({ page }) => {
  await signedIn(page);
  await page.goto("/profile");
  await expect(page.locator('input[type="date"]')).toHaveValue(user.birth_date);
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await page.locator(".birth-date-trigger").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "انتخاب تاریخ تولد" })).toBeVisible();
  await page.getByRole("button", { name: "بستن تقویم" }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator('input[type="date"]')).toHaveValue(user.birth_date);
});

for (const role of ["patient", "doctor", "insurance"]) {
  test(`${role} workspace supports both languages on mobile`, async ({ page }) => {
    await signedIn(page, role);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Hello, Alex" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "فارسی", exact: true }).click();
    await expect(page.getByRole("heading", { name: "سلام، Alex" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("authenticated images use the frontend proxy instead of the backend loopback host", async ({ page }) => {
  await signedIn(page);
  await page.route(`**/api/v1/cases/${medicalCase.id}/`, (route) => route.fulfill({ json: {
    ...medicalCase, status: "submitted", can_edit_intake: false,
    images: [{ id: "image-1", image_url: "http://127.0.0.1:8000/api/v1/images/image-1/file/", view: "other" }],
  } }));
  await page.route("**/api/v1/images/image-1/file/", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
  const imageRequest = page.waitForRequest((request) => request.url() === "http://127.0.0.1:5173/api/v1/images/image-1/file/");
  await page.goto(`/cases/${medicalCase.id}`);
  expect((await imageRequest).headers().authorization).toBe("Bearer test-token");
  await expect(page.locator(".xray-gallery img")).toHaveAttribute("src", /^blob:/);
});
