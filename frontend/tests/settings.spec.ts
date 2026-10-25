import { expect, test, type Page } from "@playwright/test";

const key = "sk-proj-browser-test-key-1234";
async function settingsSession(page: Page, failSave = false) {
  await page.addInitScript(() => { localStorage.setItem("orthomed_access", "test-token"); localStorage.setItem("orthomed_language", "en"); });
  let status = { has_api_key: false, key_last_four: "", server_key_configured: false };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/auth/me/")) return route.fulfill({ json: { id: "doctor-1", role: "doctor", first_name: "Alex", full_name: "Alex Doctor", is_verified: true } });
    if (request.url().endsWith("/auth/settings/ai/")) {
      if (request.method() === "PUT") {
        if (failSave) return route.fulfill({ status: 400, json: { errors: { openai_api_key: ["Invalid OpenAI key. It must start with sk- and contain no spaces."] } } });
        expect(request.postDataJSON()).toEqual({ openai_api_key: expect.any(String) });
        status = { ...status, has_api_key: true, key_last_four: request.postDataJSON().openai_api_key.slice(-4) };
      }
      if (request.method() === "DELETE") status = { ...status, has_api_key: false, key_last_four: "" };
      return route.fulfill({ json: status });
    }
    return route.fulfill({ json: { count: 0, results: [] } });
  });
}

test("settings saves, masks, replaces and removes a user-owned key without browser storage", async ({ page }) => {
  await settingsSession(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "AI settings", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("No API key configured yet.");
  const field = page.getByLabel("OPENAI_API_KEY", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(key);
  await page.getByRole("button", { name: "Show key", exact: true }).click();
  await expect(field).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide key", exact: true }).click();
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Personal key saved" })).toContainText("••••1234");
  await expect(field).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(key);
  expect(await page.locator("body").innerText()).not.toContain(key);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Personal key saved" })).toContainText("••••1234");
  await expect(field).toHaveValue("");
  await field.fill("sk-proj-replacement-test-key-5678");
  await page.getByRole("button", { name: "Replace key", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Personal key saved" })).toContainText("••••5678");
  await page.getByRole("button", { name: "Remove personal key", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "No API key configured yet." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove personal key", exact: true })).toHaveCount(0);
});

test("save errors do not claim a key was saved", async ({ page }) => {
  await settingsSession(page, true);
  await page.goto("/settings");
  await page.getByLabel("OPENAI_API_KEY", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.locator(".field-error").filter({ hasText: "Invalid OpenAI key. It must start with sk- and contain no spaces." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove personal key", exact: true })).toHaveCount(0);
});

test("settings works in Persian on mobile and is reachable through navigation", async ({ page }) => {
  await settingsSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تنظیمات هوش مصنوعی", exact: true })).toBeVisible();
  await expect(page.locator(".mobile-nav").getByRole("link", { name: "تنظیمات", exact: true })).toHaveAttribute("href", "/settings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/orthomed-settings-mobile-fa.png", fullPage: true });
});
