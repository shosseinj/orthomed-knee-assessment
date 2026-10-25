import { expect, test } from "@playwright/test";

for (const existing of [true, false]) {
  test(`${existing ? "existing user signs in" : "new user registers"} only after verifying the phone`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
    const calls: string[] = [];
    const user = { id: "patient-1", phone_number: "09123456789", first_name: "Sara", last_name: "Test", full_name: "Sara Test", role: "patient", is_verified: true };
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/v1/auth/otp/request/") {
        calls.push("request");
        return route.fulfill({ json: { is_mock: false } });
      }
      if (path === "/api/v1/auth/otp/verify/") {
        calls.push("verify");
        expect(route.request().postDataJSON()).toEqual({ phone_number: user.phone_number, code: "54321" });
        return route.fulfill({ json: existing ? { registration_required: false, access: "access", refresh: "refresh", user } : { registration_required: true, registration_token: "verified-phone-ticket" } });
      }
      if (path === "/api/v1/auth/register/") {
        calls.push("register");
        expect(route.request().postDataJSON()).toMatchObject({ registration_token: "verified-phone-ticket", first_name: "Sara", national_code: "0013520822", birth_date: "1990-01-01" });
        expect(route.request().postDataJSON()).not.toHaveProperty("code");
        return route.fulfill({ status: 201, json: { access: "access", refresh: "refresh", user } });
      }
      if (path === "/api/v1/auth/phone/check/") throw new Error("Account lookup must not precede OTP verification");
      return route.fulfill({ json: path.endsWith("/auth/me/") ? user : { count: 0, results: [] } });
    });
    await page.goto("/login");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByLabel("Mobile number", { exact: true }).fill(user.phone_number);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
    await expect(page.getByLabel("First name", { exact: true })).not.toBeVisible();
    expect(calls).toEqual(["request"]);
    await page.getByLabel("Verification code", { exact: true }).fill("54321");
    await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
    if (!existing) {
      await expect(page.getByRole("heading", { name: "Create your account", exact: true })).toBeVisible();
      expect(calls).toEqual(["request", "verify"]);
      expect(await page.evaluate(() => localStorage.getItem("orthomed_access"))).toBeNull();
      await page.getByLabel("First name", { exact: true }).fill("Sara");
      await page.getByLabel("Last name", { exact: true }).fill("Test");
      await page.getByLabel("National ID").fill("0013520822");
      await page.getByLabel("Date of birth", { exact: true }).fill("1990-01-01");
      await page.getByRole("button", { name: "Register and sign in", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(calls).toEqual(existing ? ["request", "verify"] : ["request", "verify", "register"]);
  });
}

test("invalid code stays on verification without revealing registration", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
  await page.route("**/api/v1/auth/otp/request/", (route) => route.fulfill({ json: { is_mock: false } }));
  await page.route("**/api/v1/auth/otp/verify/", (route) => route.fulfill({ status: 400, json: { errors: { code: ["Invalid or expired verification code."] } } }));
  await page.goto("/login");
  await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("12345");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await expect(page.getByText("Invalid or expired verification code.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
  await expect(page.getByLabel("First name", { exact: true })).not.toBeVisible();
});
