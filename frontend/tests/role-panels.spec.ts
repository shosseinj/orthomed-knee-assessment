import { expect, test } from "@playwright/test";

for (const role of ["patient", "doctor", "insurance", "admin"]) {
  test(`${role} sees its own tools and direct routes respect the role`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("orthomed_language", "en");
      localStorage.setItem("orthomed_access", "role-token");
    });
    const user = { id: "shared-identity", role, first_name: "Sara", last_name: "Test", full_name: "Sara Test", is_verified: true, can_manage_accounts: role === "admin" };
    let caseRequests = 0;
    let caseCreates = 0;
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/me/")) return route.fulfill({ json: user });
      if (path.endsWith("/cases/")) {
        caseRequests++;
        if (route.request().method() === "POST") caseCreates++;
      }
      return route.fulfill({ json: { count: 0, results: [], summary: { total: 0, pending: 0, verified: 0, inactive: 0 } } });
    });
    await page.goto("/dashboard");
    const sidebar = page.locator(".sidebar__nav");
    if (role === "admin") {
      await expect(page).toHaveURL("/management");
      await expect(sidebar.locator('a[href="/dashboard"]')).toHaveCount(0);
      await expect(sidebar.locator('a[href="/cases/new"]')).toHaveCount(0);
      await expect(sidebar.locator('a[href="/management"]')).toBeVisible();
      await page.goto("/cases/private-case");
      await expect(page).toHaveURL("/management");
      expect(caseRequests).toBe(0);
    } else {
      await expect(page).toHaveURL("/dashboard");
      await expect(sidebar.locator('a[href="/management"]')).toHaveCount(0);
      await expect(sidebar.locator('a[href="/dashboard"]')).toHaveText(role === "patient" ? "My cases" : role === "doctor" ? "Patient cases" : "Coverage review");
      await expect(page.locator(".page-heading .eyebrow")).toHaveText(role === "patient" ? "Patient workspace" : role === "doctor" ? "Doctor workspace" : "Insurance workspace");
      await expect(sidebar.locator('a[href="/cases/new"]')).toHaveCount(role === "patient" ? 1 : 0);
      await expect(page.getByRole("button", { name: "Add patient and case", exact: true })).toHaveCount(role === "doctor" ? 1 : 0);
      if (role !== "patient") {
        await page.goto("/cases/new");
        await expect(page).toHaveURL("/dashboard");
        expect(caseCreates).toBe(0);
      }
    }
  });
}
