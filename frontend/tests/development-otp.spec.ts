import { expect, test } from "@playwright/test";

for (const development of [true, false]) {
  test(`${development ? "development displays configured code" : "production hides development code"} on sign-in`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orthomed_language", "en"));
    await page.route("**/api/v1/auth/**", (route) => route.fulfill({ json: { is_registered: true, is_mock: development, ...(development ? { development_code: "11111" } : {}) } }));
    await page.goto("/login");
    await page.getByLabel("Mobile number", { exact: true }).fill("09123456789");
    await page.locator(".consent .custom-check").click();
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
