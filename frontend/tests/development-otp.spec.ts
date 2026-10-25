import { expect, test } from "@playwright/test";

for (const development of [true, false]) {
  test(`${development ? "development displays configured code" : "production hides development code"} on sign-in`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
    await page.route("**/api/v1/auth/otp/request/", (route) => route.fulfill({ json: { is_mock: development, ...(development ? { development_code: "11111" } : {}) } }));
    await page.goto("/login");
    await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
    const hint = page.locator(".auth-card__heading p");
    if (development) {
      await expect(hint).toContainText("11111");
      await expect(hint).toContainText("In development mode");
    } else {
      await expect(hint).not.toContainText("11111");
      await expect(hint).not.toContainText("In development mode");
    }
  });
}

test("SMS delivery failure keeps sign-in on the phone step and shows a delivery error", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
  await page.route("**/api/v1/auth/otp/request/", (route) => route.fulfill({ status: 503, json: { errors: { detail: "ارسال کد تأیید ممکن نشد. کمی بعد دوباره تلاش کنید." } } }));
  await page.goto("/login");
  await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Could not send a verification code. Try again shortly.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Mobile number", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Verification code", { exact: true })).not.toBeVisible();
});
