import { expect, test } from "@playwright/test";

const accounts = [
  { role: "patient", can_manage_accounts: false, en: "Patient", fa: "بیمار", destination: "/dashboard" },
  { role: "doctor", can_manage_accounts: false, en: "Doctor", fa: "پزشک", destination: "/dashboard" },
  { role: "admin", can_manage_accounts: true, en: "System administrator", fa: "مدیر سامانه", destination: "/management" },
  { role: "insurance", can_manage_accounts: false, en: "Insurance reviewer", fa: "کارشناس بیمه", destination: "/dashboard" },
] as const;

for (const language of ["en", "fa"] as const) {
  for (const account of accounts) {
    test(`${account.en} is identified after OTP and session restoration in ${language}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.addInitScript((lang) => localStorage.setItem("orthomed_language", lang), language);
      const user = { id: "account-1", phone_number: "09123456789", first_name: "Sara", last_name: "Test", full_name: "Sara Test", national_code: "0013520822", birth_date: "1990-01-01", role: account.role, can_manage_accounts: account.can_manage_accounts, is_verified: true };
      await page.route("**/api/v1/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/otp/verify/")) expect(route.request().postDataJSON().entry_role).toBe(account.can_manage_accounts ? "admin" : account.role);
        const json = path.endsWith("/otp/request/") ? { is_mock: false }
          : path.endsWith("/otp/verify/") ? { registration_required: false, access: "access", refresh: "refresh", user }
          : path.endsWith("/auth/me/") ? user
          : { count: 0, results: [], summary: { total: 0, pending: 0, verified: 0, inactive: 0 } };
        return route.fulfill({ json });
      });
      await page.goto("/login");
      await expect(page.locator(".account-role")).toHaveCount(0);
      await expect(page.getByRole("radio")).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (account.role === "patient" && !account.can_manage_accounts) await page.screenshot({ path: `/tmp/orthomed-entry-types-${language}.png`, fullPage: true });
      await page.getByRole("radio", { name: language === "en" ? account.can_manage_accounts ? "Admin" : account.role === "insurance" ? "Insurance company" : account.en : account.can_manage_accounts ? "ادمین" : account.role === "insurance" ? "شرکت بیمه" : account.fa, exact: true }).check();
      await page.getByLabel(language === "en" ? "Mobile number" : "شماره موبایل", { exact: true }).fill(user.phone_number);
      await page.getByRole("button", { name: language === "en" ? "Continue" : "ادامه", exact: true }).click();
      await page.getByLabel(language === "en" ? "Verification code" : "کد تأیید", { exact: true }).fill("54321");
      await page.getByRole("button", { name: language === "en" ? "Verify and continue" : "تأیید و ادامه", exact: true }).click();
      await expect(page).toHaveURL(account.destination);
      await expect(page.locator(".account-role")).toBeVisible();
      await expect(page.locator(".account-role")).toHaveText(account[language]);
      await expect(page.locator("html")).toHaveAttribute("dir", language === "en" ? "ltr" : "rtl");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.reload();
      await expect(page.locator(".account-role")).toHaveText(account[language]);
      await page.goto("/profile");
      await expect(page.locator(".profile-locked")).toContainText(account[language]);
      await page.setViewportSize({ width: 1440, height: 960 });
      await expect(page.locator(".account-role")).toBeVisible();
      await expect(page.locator(".sidebar__user small")).toHaveText(account[language]);
    });
  }
}

test("a doctor awaiting approval keeps the doctor role without clinical access", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("orthomed_language", "en");
    localStorage.setItem("orthomed_access", "access");
  });
  let caseRequests = 0;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/cases/")) caseRequests++;
    return route.fulfill({ json: { id: "doctor-1", role: "doctor", can_manage_accounts: false, is_verified: false, full_name: "Sara Doctor" } });
  });
  await page.goto("/login");
  await expect(page).toHaveURL("/dashboard");
  await expect(page.locator(".account-role")).toHaveText("Doctor");
  await expect(page.locator(".approval-pending")).toBeVisible();
  expect(caseRequests).toBe(0);
});
