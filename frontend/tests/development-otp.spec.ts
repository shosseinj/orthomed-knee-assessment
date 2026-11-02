import { expect, test } from "@playwright/test";

for (const development of [true, false]) {
  test(`${development ? "development displays configured code" : "production hides development code"} on sign-in`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
    await page.route("**/api/v1/auth/otp/request/", (route) => route.fulfill({ json: { is_mock: development, ...(development ? { development_code: "11111" } : {}) } }));
    await page.goto("/login");
    await page.getByRole("radio", { name: "Patient", exact: true }).check();
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
  await page.getByRole("radio", { name: "Patient", exact: true }).check();
  await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Could not send a verification code. Try again shortly.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Mobile number", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Verification code", { exact: true })).not.toBeVisible();
});

for (const smsSent of [true, false]) {
  test(`manual code completes sign-in when SMS delivery ${smsSent ? "succeeds" : "fails"}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
    const patient = { id: "patient", role: "patient", is_verified: true, can_manage_accounts: false,
      first_name: "Alex", last_name: "Patient", full_name: "Alex Patient", phone_number: "09123456789" };
    await page.route("**/api/v1/**", async (route) => {
      if (route.request().url().endsWith("/otp/request/")) {
        return route.fulfill({ status: 202, json: { is_mock: false, sms_sent: smsSent, manual_code_enabled: true } });
      }
      if (route.request().url().endsWith("/otp/verify/")) {
        expect(route.request().postDataJSON()).toEqual({ phone_number: patient.phone_number, code: "17935", entry_role: "patient" });
        return route.fulfill({ json: { registration_required: false, access: "manual-access", refresh: "manual-refresh", user: patient } });
      }
      if (route.request().url().endsWith("/auth/me/")) return route.fulfill({ json: patient });
      return route.fulfill({ json: { count: 0, results: [] } });
    });
    await page.goto("/login");
    await page.getByRole("radio", { name: "Patient", exact: true }).check();
    await page.getByLabel("Mobile number", { exact: true }).fill(patient.phone_number);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("If you did not receive an SMS, you can enter the manual sign-in code in this field.", { exact: true })).toBeVisible();
    await expect(page.locator(".auth-card")).not.toContainText("17935");
    if (!smsSent) {
      await expect(page.locator(".auth-card__heading p")).toHaveText("The SMS could not be sent. Enter the manual sign-in code or request another SMS.");
    }
    await page.getByLabel("Verification code", { exact: true }).fill("17935");
    await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await page.evaluate(() => localStorage.getItem("orthomed_access"))).toBe("manual-access");
  });
}
