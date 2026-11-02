import { expect, test } from "@playwright/test";

test("formatting preserves clinical numbers, list numbering and legacy plain text", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/components/AIAnalysisReport.tsx";
    const { splitAIReport } = await import(modulePath);
    return {
      numbered: splitAIReport("### بررسی‌های تکمیلی\n۳. مقدار 12.5 و امتیاز ۵/۱۰ حفظ شود.\n۷) مورد بعدی بدون تغییر شماره."),
      headings: splitAIReport("**یافته‌های تصویری**\nنمای رخ دیده می‌شود.\n- داده بالینی: درد 34 ماه گزارش شده است.\nتحلیل و تفسیر نهایی: **نیازمند بررسی بیشتر**"),
      plain: splitAIReport("این پاسخ قدیمی عنوان ندارد. مقدار 6.2 و فاصله 2.5 در متن حفظ می‌شود."),
    };
  });
  expect(result.numbered[0].title).toBe("بررسی‌های تکمیلی");
  expect(result.numbered[0].blocks[0]).toEqual({ kind: "ordered", ordinals: [3, 7], items: ["مقدار 12.5 و امتیاز ۵/۱۰ حفظ شود.", "مورد بعدی بدون تغییر شماره."] });
  expect(result.headings.map((section: { title: string }) => section.title)).toEqual(["یافته‌های تصویری", "داده بالینی", "تحلیل و تفسیر نهایی"]);
  expect(result.headings[1].blocks[0].items).toEqual(["درد 34 ماه گزارش شده است."]);
  expect(result.headings[2].blocks[0].items).toEqual(["**نیازمند بررسی بیشتر**"]);
  expect(result.plain).toEqual([{ title: "", blocks: [{ kind: "paragraph", items: ["این پاسخ قدیمی عنوان ندارد. مقدار 6.2 و فاصله 2.5 در متن حفظ می‌شود."] }] }]);
});

test("the AI answer has readable sections in the main column and retains literal untrusted text", async ({ page }) => {
  const id = "12345678-1234-1234-1234-123456789012";
  const patient = { id: "patient", first_name: "کاربر", full_name: "کاربر آزمایشی", role: "patient", is_verified: true };
  const rationale = "یافته‌های تصویری:\n- تصویر 11111111-2222-4333-8444-555555555555: نمای رخ زانو در دسترس است.\nداده بالینی: مدت درد 34 ماه و امتیاز ۵/۱۰ ثبت شده است.\nنیاز به بررسی تکمیلی: بله\nمحدودیت‌ها: <script>window.aiUnsafeExecuted = true</script>";
  const record = { id, patient, title: "ارزیابی جراحی زانو", status: "submitted", status_label: "در انتظار بررسی", can_edit_intake: false, created_at: "2026-11-02T12:00:00Z", images: [], assessments: [{ id: "ai", source: "ai", source_label: "هوش مصنوعی", verdict: "inconclusive", verdict_label: "نیازمند بررسی بیشتر", kl_grade: 1, rationale }] };
  let analysisRequests = 0;
  await page.addInitScript(() => { localStorage.setItem("orthomed_access", "test-token"); localStorage.setItem("orthomed_language", "fa"); });
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/ai-assessment/")) analysisRequests++;
    return route.fulfill({ json: route.request().url().endsWith("/auth/me/") ? { ...patient, id: "doctor", role: "doctor" } : record });
  });
  await page.goto(`/cases/${id}`);
  const report = page.locator(".review-main > .ai-report");
  await expect(report).toBeVisible();
  await expect(report.locator(".ai-report__section")).toHaveCount(4);
  await expect(report.getByRole("heading", { name: /یافته‌های تصویری/ })).toBeVisible();
  await expect(report).toContainText("مدت درد 34 ماه و امتیاز ۵/۱۰ ثبت شده است.");
  await expect(report.locator("ul li")).toContainText("11111111-2222-4333-8444-555555555555");
  await expect(report).toContainText("<script>window.aiUnsafeExecuted = true</script>");
  expect(await page.evaluate(() => (window as Window & { aiUnsafeExecuted?: boolean }).aiUnsafeExecuted)).toBeUndefined();
  await page.evaluate(() => document.fonts.ready);
  expect(await report.locator("p").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(analysisRequests).toBe(0);
});
