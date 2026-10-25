import { choosePersianDate } from "./intake-helpers";
import { expect, test, type Page } from "@playwright/test";

const patient = { id: "patient-1", phone_number: "09501234567", first_name: "حسین", last_name: "محمدی", full_name: "حسین محمدی", national_code: "0013520822", birth_date: "1964-04-20", role: "patient", is_verified: true };
const baseQuestionnaire = { intake_version: "2.0", age_years: 62, gender: "male", underlying_conditions: [], medications: [], height_cm: "170", weight_kg: "75", pain_level: 0, pain_duration_months: 60, mobility_limit: "mild", previous_treatments: [], conservative_treatment_rounds: 0, conservative_duration_months: 0, conservative_response: "not_tried", had_intra_articular_injection: false, injection_rounds: 0, injection_types: [], daily_life_impact: "none", smoking_status: "never", diabetes_status: "none", has_night_pain: false, uses_walking_aid: false, additional_notes: "", affected_knee: "both", worst_pain_month: 0, walking_pain: 0, night_pain_frequency: "none", walking_capacity: "over_10", stair_difficulty: "none", daily_activity_pain: 0, sleep_disruption: 0, physiotherapy_sessions: "none", physiotherapy_effect: "not_tried", takes_painkillers: false, painkillers: [], weight_loss_attempted: false, common_conditions: ["none"], red_flags: ["none"] };
const womac = { responses: Object.fromEntries([...[1,2,3,4,5].map((n) => `p${n}`), "s1", "s2", ...Array.from({ length: 17 }, (_, n) => `f${n+1}`)].map((key) => [key, 0])), supplemental_responses: {}, pain_score: 0, stiffness_score: 0, function_score: 0, total_score: 0, normalized_score: "0", health_score: 100 };
const id = "12345678-1234-1234-1234-123456789012";
const image = { id: "image-1", image_url: "/api/v1/images/image-1/file/", purpose: "xray", view: "other" };
async function setup(page: Page, { role = "patient", status = "draft", images = [] as object[], hasWomac = false } = {}) {
  await page.addInitScript(() => { localStorage.setItem("orthomed_access", "test-token"); localStorage.setItem("orthomed_refresh", "test-refresh"); localStorage.setItem("orthomed_language", "fa"); });
  let record = { id, title: "ارزیابی جراحی زانو", patient, status, status_label: "پیش‌نویس", can_edit_intake: status === "draft", created_at: "2026-10-25T12:00:00Z", questionnaire: baseQuestionnaire, images, assessments: [] as object[], womac: hasWomac ? womac : undefined };
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(); const url = req.url();
    if (url.endsWith("/auth/me/")) return route.fulfill({ json: { ...patient, id: role === "doctor" ? "doctor-1" : patient.id, role } });
    if (url.endsWith("/questionnaire/") && req.method() === "PUT") { record = { ...record, questionnaire: req.postDataJSON() }; return route.fulfill({ json: record.questionnaire }); }
    if (url.endsWith("/images/image-1/") && req.method() === "DELETE") { record = { ...record, images: [] }; return route.fulfill({ status: 204 }); }
    if (url.endsWith("/images/") && req.method() === "POST") { record = { ...record, images: [{ ...image, purpose: "lab" }] }; return route.fulfill({ json: image }); }
    if (url.endsWith("/file/")) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") });
    return route.fulfill({ json: url.includes("/catalogs/") ? { results: [], count: 0, next_offset: null } : record });
  });
  return { getRecord: () => record, update: (changes: Partial<typeof record>) => { record = { ...record, ...changes }; } };
}

test("conditional medications, multiyear duration and diabetes values save without losing zeros", async ({ page }) => {
  const { getRecord } = await setup(page);
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  await expect(page.getByLabel("مدت علائم", { exact: false }).first()).toHaveValue("5");
  await page.getByLabel("مدت علائم", { exact: false }).first().fill("7");
  await page.getByLabel("آیا برای درد زانو مسکن مصرف می‌کنید؟", { exact: false }).selectOption("yes");
  await page.getByText("انتخاب مسکن‌ها (امکان انتخاب چند مورد)", { exact: true }).click();
  for (const name of ["دیکلوفناک", "ناپروکسن", "ملوکسیکام", "استامینوفن", "فاروکسی فن", "گاباپنتین", "پره گابالین", "سایر"]) await expect(page.locator(".painkiller-picker").getByText(name, { exact: true })).toBeVisible();
  await page.locator(".painkiller-picker").getByText("دیکلوفناک", { exact: true }).click();
  await page.locator(".painkiller-picker").getByText("سایر", { exact: true }).click();
  await page.getByLabel("نام سایر مسکن‌ها").fill("مسکن تجویزی");
  await page.getByLabel("پاسخ درد به مسکن‌ها", { exact: false }).selectOption("moderate");
  await page.getByLabel("وضعیت دیابت", { exact: false }).selectOption("controlled");
  await expect(page.getByLabel("قند خون ناشتا (mg/dL)")).toBeVisible();
  await page.getByLabel("قند خون ناشتا (mg/dL)").fill("112");
  await page.getByLabel("قند سه‌ماهه HbA1c (٪)").fill("6.4");
  await page.getByLabel("سابقه مصرف سیگار/نیکوتین", { exact: false }).selectOption("former");
  await choosePersianDate(page, "تاریخ شروع مصرف دخانیات", 1400, 1, 1);
  await choosePersianDate(page, "تاریخ ترک دخانیات", 1403, 1, 1);
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expect(page.getByRole("heading", { name: "پرسش‌نامه WOMAC", exact: true })).toBeVisible();
  expect(getRecord().questionnaire).toMatchObject({ pain_duration_months: 84, pain_level: 0, worst_pain_month: 0, takes_painkillers: true, painkillers: ["دیکلوفناک", "other"], painkiller_other: "مسکن تجویزی", fasting_glucose: "112", hba1c: "6.4", smoking_start_date: "2021-03-21", smoking_end_date: "2024-03-20" });
  expect(await page.locator(".womac-item strong").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(17);
});

test("lab upload preserves unsaved intake and supports deletion", async ({ page }) => {
  await setup(page);
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  await page.getByLabel("سن", { exact: false }).first().fill("68");
  await page.getByLabel("وضعیت دیابت", { exact: false }).selectOption("controlled");
  const request = page.waitForRequest((req) => req.method() === "POST" && req.url().endsWith("/images/"));
  await page.locator('input[type="file"]').setInputFiles({ name: "lab.png", mimeType: "image/png", buffer: Buffer.from("test") });
  expect((await request).postData()).toContain('name="purpose"\r\n\r\nlab');
  await expect(page.getByLabel("سن", { exact: false }).first()).toHaveValue("68");
  await expect(page.locator(".image-grid img")).toHaveCount(1);
  await page.getByRole("button", { name: "حذف تصویر 1" }).click();
  await expect(page.locator(".image-grid img")).toHaveCount(0);
  await expect(page.getByLabel("سن", { exact: false }).first()).toHaveValue("68");
});

test("deleting the last xray disables submission", async ({ page }) => {
  await setup(page, { images: [image], hasWomac: true });
  await page.goto(`/cases/${id}`);
  await expect(page.getByRole("button", { name: "ارسال برای بررسی" })).toBeEnabled();
  await page.getByRole("button", { name: "حذف تصویر 1" }).click();
  await expect(page.getByRole("button", { name: "ارسال برای بررسی" })).toBeDisabled();
});

test("doctor can retry AI assessment and see results for Hossein Mohammadi", async ({ page }) => {
  const state = await setup(page, { role: "doctor", status: "submitted", hasWomac: true, images: [image] });
  let calls = 0;
  await page.route(`**/cases/${id}/ai-assessment/`, async (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, json: { detail: "سرویس هوش مصنوعی پیکربندی نشده است؛ تنظیم کلید سرویس توسط مدیر لازم است." } });
    const assessment = { id: "ai-1", source: "ai", source_label: "هوش مصنوعی", verdict: "inconclusive", verdict_label: "نیازمند بررسی بیشتر", rationale: "نیاز به بررسی تکمیلی: بله؛ پاسخ آزمایشی سرویس", kl_grade: 2 };
    state.update({ assessments: [assessment] });
    return route.fulfill({ json: assessment });
  });
  await page.goto(`/cases/${id}`);
  await expect(page.getByRole("heading", { name: "حسین محمدی", exact: true })).toBeVisible();
  await expect(page.getByText("کاهش عوامل خطر پیش از تصمیم جراحی", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "دریافت نظر هوش مصنوعی", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("پیکربندی نشده");
  await page.getByRole("button", { name: "تلاش دوباره برای دریافت نظر هوش مصنوعی" }).click();
  await expect(page.getByRole("heading", { name: "نتیجه تحلیل هوشمند" })).toBeVisible();
  await expect(page.getByText("نیاز به بررسی تکمیلی: بله؛ پاسخ آزمایشی سرویس")).toBeVisible();
  await expect(page.getByLabel("فلکشن (درجه)")).toBeVisible();
  await page.screenshot({ path: "/tmp/orthomed-doctor-fa.png", fullPage: true });
});

test("mobile intake is readable and sidebar logout clears tokens", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/orthomed-patient-mobile-fa.png", fullPage: true });
  await page.getByRole("button", { name: "باز کردن منو", exact: true }).click();
  await page.locator(".sidebar__logout").click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("orthomed_access"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("orthomed_refresh"))).toBeNull();
});

async function expectFieldInView(page: Page, name: string) {
  const field = page.locator(`[data-field="${name}"]`);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field.locator(".field-error")).toBeVisible();
  await expect.poll(() => field.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 70 && rect.top < innerHeight - 100;
  })).toBe(true);
}

test("saving an incomplete intake focuses and scrolls to its first required field", async ({ page }) => {
  await setup(page);
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  await page.locator('input[name="age_years"]').fill("");
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expectFieldInView(page, "age_years");
  await expect(page.locator('input[name="age_years"]')).toBeFocused();
  await page.locator('input[name="age_years"]').fill("63");
  await expect(page.locator('[data-field="age_years"] .field-error')).toHaveCount(0);
});

test("missing checkbox groups scroll into view on mobile", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  await page.locator('[data-field="common_conditions"]').getByText("هیچ‌کدام", { exact: true }).click();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expectFieldInView(page, "common_conditions");
  await expect(page.locator('[data-field="common_conditions"]')).toBeFocused();
  await page.locator('[data-field="common_conditions"]').getByText("هیچ‌کدام", { exact: true }).click();
  await expect(page.locator('[data-field="common_conditions"] .field-error')).toHaveCount(0);
});

test("server validation scrolls to the first field in form order and keeps entered values", async ({ page }) => {
  await setup(page);
  await page.route(`**/cases/${id}/questionnaire/`, (route) => route.fulfill({ status: 400, json: { errors: {
    hba1c: ["مقدار HbA1c را دوباره بررسی کنید."], fasting_glucose: ["قند ناشتا را دوباره بررسی کنید."],
  } } }));
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  await page.getByLabel("وضعیت دیابت", { exact: false }).selectOption("controlled");
  await page.getByLabel("قند خون ناشتا (mg/dL)").fill("112");
  await page.getByLabel("قند سه‌ماهه HbA1c (٪)").fill("6.4");
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expectFieldInView(page, "fasting_glucose");
  await expect(page.locator('input[name="fasting_glucose"]')).toBeFocused();
  await expect(page.locator('input[name="hba1c"]')).toHaveValue("6.4");
  await expect(page.locator('[data-field="hba1c"] .field-error')).toContainText("مقدار HbA1c");
});

test("Persian calendar handles leap Esfand and minimum dates without offering future years", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  await page.getByLabel("سابقه مصرف سیگار/نیکوتین", { exact: false }).selectOption("former");
  await choosePersianDate(page, "تاریخ شروع مصرف دخانیات", 1403, 12, 30);
  await page.getByRole("button", { name: "تاریخ ترک دخانیات", exact: true }).click();
  await page.locator(".birth-date-modal__year-trigger").click();
  const yearValues = await page.locator(".birth-date-modal__year-grid button").allTextContents();
  const numbers = yearValues.map((value) => Number(value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))));
  expect(numbers.every((year) => year >= 1403 && year <= 1405)).toBe(true);
  await page.locator(".birth-date-modal__year-grid").getByRole("button", { name: "۱۴۰۳", exact: true }).click();
  await expect(page.getByRole("gridcell", { name: "۲۹ اسفند ۱۴۰۳", exact: true })).toBeDisabled();
  await page.getByRole("gridcell", { name: "۳۰ اسفند ۱۴۰۳", exact: true }).click();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expect(page.getByRole("heading", { name: "پرسش‌نامه WOMAC", exact: true })).toBeVisible();
  expect(state.getRecord().questionnaire).toMatchObject({ smoking_start_date: "2025-03-20", smoking_end_date: "2025-03-20" });
});

test("invalid saved date order focuses the Persian date control", async ({ page }) => {
  const state = await setup(page);
  state.update({ questionnaire: { ...baseQuestionnaire, smoking_status: "former", smoking_start_date: "2025-03-20", smoking_end_date: "2024-03-20" } as typeof baseQuestionnaire });
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: /شرح حال/ }).click();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expectFieldInView(page, "smoking_end_date");
  await expect(page.getByRole("button", { name: "تاریخ ترک دخانیات", exact: true })).toBeFocused();
  await choosePersianDate(page, "تاریخ ترک دخانیات", 1403, 12, 30);
  await expect(page.locator('[data-field="smoking_end_date"] .field-error')).toHaveCount(0);
});

test("WOMAC save scrolls to the first unanswered question", async ({ page }) => {
  await setup(page);
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expectFieldInView(page, "p1");
  await expect(page.locator('[data-field="p1"] button').first()).toBeFocused();
  await page.locator('[data-field="p1"] button').first().click();
  await expect(page.locator('[data-field="p1"] .field-error')).toHaveCount(0);
});

for (const role of ["patient", "doctor", "insurance"]) {
  test(`${role} opens account info from sidebar and has one sidebar logout`, async ({ page }) => {
    await setup(page, { role });
    await page.goto(`/cases/${id}`);
    const exits = page.getByRole("button", { name: "خروج از حساب", exact: true, includeHidden: true });
    await expect(exits).toHaveCount(1);
    await expect(page.locator(".sidebar__logout")).toBeVisible();
    await expect(page.locator(".topbar").getByRole("button", { name: "خروج از حساب", exact: true })).toHaveCount(0);
    await expect(page.locator(".topbar__actions").getByRole("button")).toHaveCount(3);
    await expect(page.locator(".topbar").getByRole("button", { name: "اعلان‌ها", exact: true })).toBeVisible();
    await expect(page.locator(".sidebar__nav").getByRole("link", { name: "اطلاعات من", exact: true })).toHaveCount(0);
    await expect(page.locator('.mobile-nav a[href="/profile"]')).toHaveCount(0);
    await expect(page.locator(".sidebar__footer .sidebar__user")).toContainText("حسین محمدی");
    await page.locator(".sidebar__user").click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { name: "اطلاعات من", exact: true })).toBeVisible();
    if (role === "patient") await expect(page.locator('[data-field="first_name"] input')).toHaveValue("حسین");
    else await expect(page.locator(".profile-card")).toContainText("حسین");
    if (role === "patient") await page.screenshot({ path: "/tmp/orthomed-sidebar-profile-fa.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "باز کردن منو", exact: true }).click();
    await expect(exits).toHaveCount(1);
    await expect(page.locator(".sidebar__logout")).toBeVisible();
    await page.locator(".sidebar__logout").click();
    await expect(page).toHaveURL(/\/login$/);
  });
}

test("doctor save focuses the first missing examination answer", async ({ page }) => {
  await setup(page, { role: "doctor", status: "submitted", hasWomac: true });
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: "ثبت نظر نهایی", exact: true }).click();
  await expectFieldInView(page, "has_lower_back_pain");
  await expect(page.locator('[data-field="has_lower_back_pain"] select')).toBeFocused();
});

test("profile save focuses missing details and server errors on Persian birth dates", async ({ page }) => {
  await setup(page);
  await page.route("**/auth/me/", (route) => route.fulfill({ json: route.request().method() === "PATCH" ? { errors: { birth_date: ["تاریخ تولد را بررسی کنید."] } } : patient, status: route.request().method() === "PATCH" ? 400 : 200 }));
  await page.goto("/profile");
  await page.locator('[data-field="first_name"] input').fill("");
  await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await expectFieldInView(page, "first_name");
  await page.locator('[data-field="first_name"] input').fill("حسین");
  await page.getByRole("button", { name: "ذخیره تغییرات", exact: true }).click();
  await expectFieldInView(page, "birth_date");
  await expect(page.getByRole("button", { name: "تاریخ تولد", exact: true })).toBeFocused();
});
