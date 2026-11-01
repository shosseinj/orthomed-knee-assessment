import { expect, test } from "@playwright/test";

for (const language of ["en", "fa"] as const) {
  test(`admin signup verifies its password and opens management in ${language}`, async ({ page }) => {
    const existingIdentity = language === "fa";
    const password = "Test-Registration-Secret-123";
    const identity = { first_name: "Sara", last_name: "Test", national_code: "0013520822", birth_date: "1990-01-01" };
    const user = { ...identity, id: "admin-identity", phone_number: "09123456789", full_name: "Sara Test", role: "admin", is_verified: true, can_manage_accounts: true };
    const label = (en: string, fa: string) => language === "en" ? en : fa;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((lang) => localStorage.setItem("orthomed_language", lang), language);
    let registrationAttempts = 0;
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/otp/request/")) return route.fulfill({ json: { is_mock: false } });
      if (path.endsWith("/otp/verify/")) {
        expect(route.request().postDataJSON().entry_role).toBe("admin");
        return route.fulfill({ json: { registration_required: true, registration_token: "verified-admin-ticket", ...(existingIdentity ? { registration_profile: identity } : {}) } });
      }
      if (path.endsWith("/register/")) {
        registrationAttempts++;
        const data = route.request().postDataJSON();
        expect(data).toMatchObject({ ...identity, role: "admin", registration_token: "verified-admin-ticket" });
        expect(data).not.toHaveProperty("is_staff");
        expect(data).not.toHaveProperty("is_superuser");
        if (data.admin_password !== password) return route.fulfill({ status: 400, json: { errors: { admin_password: ["رمز ثبت‌نام ادمین نامعتبر است."] } } });
        return route.fulfill({ status: 201, json: { access: "admin-access", refresh: "admin-refresh", user } });
      }
      return route.fulfill({ json: path.endsWith("/auth/me/") ? user : { count: 0, results: [], summary: { total: 0, pending: 0, verified: 0, inactive: 0 } } });
    });

    await page.goto("/login");
    await page.getByRole("radio", { name: label("Admin", "ادمین"), exact: true }).check();
    await page.getByLabel(label("Mobile number", "شماره موبایل"), { exact: true }).fill(user.phone_number);
    await page.getByRole("button", { name: label("Continue", "ادامه"), exact: true }).click();
    await page.getByLabel(label("Verification code", "کد تأیید"), { exact: true }).fill("54321");
    await page.getByRole("button", { name: label("Verify and continue", "تأیید و ادامه"), exact: true }).click();
    await expect(page.getByRole("heading", { name: label("Create your account", "ساخت حساب کاربری"), exact: true })).toBeVisible();
    if (existingIdentity) {
      await expect(page.getByLabel("نام", { exact: true })).toHaveValue("Sara");
      await expect(page.getByLabel("تاریخ تولد", { exact: true })).toBeDisabled();
    } else {
      await page.getByLabel("First name", { exact: true }).fill(identity.first_name);
      await page.getByLabel("Last name", { exact: true }).fill(identity.last_name);
      await page.getByLabel("National ID").fill(identity.national_code);
      await page.getByLabel("Date of birth", { exact: true }).fill(identity.birth_date);
    }
    const secret = page.getByLabel(label("Admin registration password", "رمز ثبت‌نام ادمین"), { exact: true });
    const submit = page.getByRole("button", { name: label("Register and sign in", "ثبت‌نام و ورود"), exact: true });
    await expect(secret).toHaveAttribute("type", "password");
    await expect(submit).toBeDisabled();
    await secret.fill("wrong-password");
    await submit.click();
    await expect(page.getByRole("alert")).toContainText(label("The admin registration password is invalid.", "رمز ثبت‌نام ادمین نامعتبر است."));
    await expect(secret).toHaveValue("");
    expect(await page.evaluate(() => localStorage.getItem("orthomed_access"))).toBeNull();
    await secret.fill(password);
    await submit.click();
    await expect(page).toHaveURL("/management");
    await expect(page.locator(".account-role")).toHaveText(label("System administrator", "مدیر سامانه"));
    await expect(page.locator('.sidebar__nav a[href="/dashboard"]')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(password);
    expect(registrationAttempts).toBe(2);
  });
}
