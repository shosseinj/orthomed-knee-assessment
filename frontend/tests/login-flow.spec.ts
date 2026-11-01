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
        expect(route.request().postDataJSON()).toEqual({ phone_number: user.phone_number, code: "54321", entry_role: "patient" });
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
    await expect(page.getByLabel("Mobile number", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await page.getByRole("radio", { name: "Patient", exact: true }).check();
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
  await page.getByRole("radio", { name: "Patient", exact: true }).check();
  await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("12345");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await expect(page.getByText("Invalid or expired verification code.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
  await expect(page.getByLabel("First name", { exact: true })).not.toBeVisible();
});

for (const role of ["doctor", "insurance"] as const) {
  test(`new ${role} completes signup with the type selected before OTP`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
    const calls: string[] = [];
    const label = role === "doctor" ? "Doctor" : "Insurance company";
    const user = { id: "new-account", phone_number: "09123456789", first_name: "Sara", last_name: "Test", full_name: "Sara Test", role, is_verified: false, can_manage_accounts: false };
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/otp/request/")) return route.fulfill({ json: { is_mock: false } });
      if (path.endsWith("/otp/verify/")) {
        calls.push("verify");
        expect(route.request().postDataJSON().entry_role).toBe(role);
        return route.fulfill({ json: { registration_required: true, registration_token: "verified-role-ticket" } });
      }
      if (path.endsWith("/register/")) {
        calls.push("register");
        expect(route.request().postDataJSON()).toMatchObject({ role, registration_token: "verified-role-ticket", ...(role === "doctor" ? { medical_council_number: "123456" } : { organization_name: "Sample Insurance" }) });
        return route.fulfill({ status: 201, json: { access: "access", refresh: "refresh", user } });
      }
      return route.fulfill({ json: path.endsWith("/auth/me/") ? user : { count: 0, results: [] } });
    });
    await page.goto("/login");
    await page.getByRole("radio", { name: label, exact: true }).check();
    await page.getByLabel("Mobile number", { exact: true }).fill(user.phone_number);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator(".signup-phone")).toContainText(label);
    await page.getByLabel("Verification code", { exact: true }).fill("54321");
    await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create your account", exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("orthomed_access"))).toBeNull();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByText(`Account type: ${label}`, { exact: true })).toBeVisible();
    await page.getByLabel("First name", { exact: true }).fill("Sara");
    await page.getByLabel("Last name", { exact: true }).fill("Test");
    await page.getByLabel("National ID").fill("0013520822");
    await page.getByLabel("Date of birth", { exact: true }).fill("1990-01-01");
    await page.getByLabel(role === "doctor" ? "Medical council number" : "Insurance organization name", { exact: true }).fill(role === "doctor" ? "123456" : "Sample Insurance");
    await page.getByRole("button", { name: "Register and sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator(".account-role")).toHaveText(role === "doctor" ? "Doctor" : "Insurance reviewer");
    await expect(page.locator(".approval-pending")).toBeVisible();
    expect(calls).toEqual(["verify", "register"]);
  });
}

test("Admin entry rejection allows correcting type without a session or signup", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
  const message = "ورود ادمین فقط برای حساب دارای دسترسی مدیر سامانه امکان‌پذیر است. ثبت‌نام عمومی ادمین مجاز نیست.";
  await page.route("**/api/v1/auth/otp/request/", (route) => route.fulfill({ json: { is_mock: false } }));
  await page.route("**/api/v1/auth/otp/verify/", (route) => route.fulfill({ status: 400, json: { errors: { entry_role: [message] } } }));
  await page.goto("/login");
  await page.getByRole("radio", { name: "Admin", exact: true }).check();
  await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("54321");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Public admin registration is unavailable.");
  await expect(page.getByRole("radio", { name: "Admin", exact: true })).toBeChecked();
  await expect(page.getByLabel("Mobile number", { exact: true })).toHaveValue("09123456789");
  await expect(page.getByLabel("First name", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("orthomed_access"))).toBeNull();
  await page.getByRole("radio", { name: "Doctor", exact: true }).check();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".signup-phone")).toContainText("Doctor");
});

for (const role of ["doctor", "insurance"] as const) {
  test(`a registered patient can register the ${role} role with the same identity`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
    const identity = { first_name: "Sara", last_name: "Test", national_code: "0013520822", birth_date: "1990-01-01" };
    const label = role === "doctor" ? "Doctor" : "Insurance company";
    let registrations = 0;
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/otp/request/")) return route.fulfill({ json: { is_mock: false } });
      if (path.endsWith("/otp/verify/")) {
        expect(route.request().postDataJSON().entry_role).toBe(role);
        return route.fulfill({ json: { registration_required: true, registration_token: "additional-role-ticket", registration_profile: identity } });
      }
      if (path.endsWith("/register/")) {
        registrations++;
        expect(route.request().postDataJSON()).toMatchObject({ ...identity, role, registration_token: "additional-role-ticket" });
        return route.fulfill({ status: 201, json: { access: `${role}-access`, refresh: "refresh", user: { ...identity, id: "same-identity", role, phone_number: "09123456789", full_name: "Sara Test", is_verified: false, can_manage_accounts: false } } });
      }
      return route.fulfill({ json: { count: 0, results: [] } });
    });
    await page.goto("/login");
    await page.getByRole("radio", { name: label, exact: true }).check();
    await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Verification code", { exact: true }).fill("54321");
    await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
    await expect(page.getByText("Your identity is already registered. This role requires its own registration.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Sara");
    await expect(page.getByLabel("First name", { exact: true })).toHaveAttribute("readonly", "");
    await expect(page.getByLabel("National ID")).toHaveValue(identity.national_code);
    await expect(page.getByLabel("Date of birth", { exact: true })).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem("orthomed_access"))).toBeNull();
    await page.getByLabel(role === "doctor" ? "Medical council number" : "Insurance organization name", { exact: true }).fill(role === "doctor" ? "123456" : "Sample Insurance");
    await page.getByRole("button", { name: "Register and sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator(".approval-pending")).toBeVisible();
    await expect(page.locator(".account-role")).toHaveText(role === "doctor" ? "Doctor" : "Insurance reviewer");
    expect(registrations).toBe(1);
  });
}

test("changing the type during verification requests a new code for the new selection", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
  let requests = 0;
  await page.route("**/api/v1/auth/otp/request/", (route) => { requests++; return route.fulfill({ json: { is_mock: false } }); });
  await page.goto("/login");
  await page.getByRole("radio", { name: "Doctor", exact: true }).check();
  await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Change account type or number", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Doctor", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Insurance company", exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".signup-phone")).toContainText("Insurance company");
  expect(requests).toBe(2);
});
