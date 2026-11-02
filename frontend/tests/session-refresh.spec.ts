import { expect, test, type Page } from "@playwright/test";

async function startSession(page: Page) {
  await page.goto("/login");
  await expect(page.locator(".auth-card")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("orthomed_access", "expired-access");
    localStorage.setItem("orthomed_refresh", "valid-refresh");
  });
}

test("concurrent protected requests refresh once, rotate tokens, and retry with the new access token", async ({ page }) => {
  let refreshes = 0;
  let initialRequests = 0;
  let releaseRequests = () => {};
  const bothStarted = new Promise<void>((resolve) => { releaseRequests = resolve; });
  await page.route("**/api/v1/auth/token/refresh/", async (route) => {
    refreshes++;
    expect(route.request().postDataJSON()).toEqual({ refresh: "valid-refresh" });
    await bothStarted;
    await route.fulfill({ json: { access: "renewed-access", refresh: "rotated-refresh" } });
  });
  await page.route("**/api/v1/session-probe/*", async (route) => {
    if (route.request().headers().authorization === "Bearer expired-access") {
      if (++initialRequests === 2) releaseRequests();
      return route.fulfill({ status: 401, json: { errors: { code: "token_not_valid" } } });
    }
    expect(route.request().headers().authorization).toBe("Bearer renewed-access");
    return route.fulfill({ json: { ok: true } });
  });
  await startSession(page);
  const result = await page.evaluate(async () => {
    const modulePath = "/src/api/client.ts";
    const { api } = await import(modulePath);
    const responses = await Promise.all([api("/session-probe/one"), api("/session-probe/two")]);
    return { responses, access: localStorage.getItem("orthomed_access"), refresh: localStorage.getItem("orthomed_refresh") };
  });
  expect(refreshes).toBe(1);
  expect(result).toEqual({ responses: [{ ok: true }, { ok: true }], access: "renewed-access", refresh: "rotated-refresh" });
});

test("a protected mutation retries only once if the renewed token is also rejected", async ({ page }) => {
  let mutations = 0;
  let refreshes = 0;
  await page.route("**/api/v1/auth/token/refresh/", (route) => {
    refreshes++;
    return route.fulfill({ json: { access: "renewed-access", refresh: "rotated-refresh" } });
  });
  await page.route("**/api/v1/session-probe/save", (route) => {
    mutations++;
    expect(route.request().postDataJSON()).toEqual({ answer: 1 });
    return route.fulfill({ status: 401, json: { errors: { code: "token_not_valid" } } });
  });
  await startSession(page);
  const status = await page.evaluate(async () => {
    const modulePath = "/src/api/client.ts";
    const { api } = await import(modulePath);
    try { await api("/session-probe/save", { method: "POST", body: JSON.stringify({ answer: 1 }) }); }
    catch (error) { return (error as { status: number }).status; }
  });
  expect(status).toBe(401);
  expect(mutations).toBe(2);
  expect(refreshes).toBe(1);
});

test("invalid refresh tokens leave the failed mutation unreplayed", async ({ page }) => {
  let mutations = 0;
  await page.route("**/api/v1/auth/token/refresh/", (route) => route.fulfill({ status: 401, json: { detail: "Token is invalid" } }));
  await page.route("**/api/v1/session-probe/save", (route) => {
    mutations++;
    return route.fulfill({ status: 401, json: { errors: { code: "token_not_valid" } } });
  });
  await startSession(page);
  const status = await page.evaluate(async () => {
    const modulePath = "/src/api/client.ts";
    const { api } = await import(modulePath);
    try { await api("/session-probe/save", { method: "POST" }); }
    catch (error) { return (error as { status: number }).status; }
  });
  expect(status).toBe(401);
  expect(mutations).toBe(1);
});

test("signing out during a refresh cannot restore the old session or replay a request", async ({ page }) => {
  let mutations = 0;
  await page.route("**/api/v1/auth/token/refresh/", async (route) => {
    await page.evaluate(() => {
      localStorage.removeItem("orthomed_access");
      localStorage.removeItem("orthomed_refresh");
    });
    await route.fulfill({ json: { access: "renewed-access", refresh: "rotated-refresh" } });
  });
  await page.route("**/api/v1/session-probe/save", (route) => {
    mutations++;
    return route.fulfill({ status: 401, json: { errors: { code: "token_not_valid" } } });
  });
  await startSession(page);
  const result = await page.evaluate(async () => {
    const modulePath = "/src/api/client.ts";
    const { api } = await import(modulePath);
    let status = 0;
    try { await api("/session-probe/save", { method: "POST" }); }
    catch (error) { status = (error as { status: number }).status; }
    return { status, access: localStorage.getItem("orthomed_access"), refresh: localStorage.getItem("orthomed_refresh") };
  });
  expect(result).toEqual({ status: 401, access: null, refresh: null });
  expect(mutations).toBe(1);
});

test("image uploads refresh expired sessions and preserve the file on retry", async ({ page }) => {
  let uploads = 0;
  await page.route("**/api/v1/auth/token/refresh/", (route) => route.fulfill({ json: { access: "renewed-access", refresh: "rotated-refresh" } }));
  await page.route("**/api/v1/cases/test-case/images/", (route) => {
    uploads++;
    const body = route.request().postDataBuffer()!.toString();
    expect(body).toContain('filename="knee.png"');
    expect(body).toContain('name="declared_side"\r\n\r\nunknown');
    if (route.request().headers().authorization === "Bearer expired-access") {
      return route.fulfill({ status: 401, json: { errors: { code: "token_not_valid" } } });
    }
    expect(route.request().headers().authorization).toBe("Bearer renewed-access");
    return route.fulfill({ status: 201, json: { id: "uploaded" } });
  });
  await startSession(page);
  const result = await page.evaluate(async () => {
    const modulePath = "/src/api/client.ts";
    const { casesApi } = await import(modulePath);
    const data = new FormData();
    data.append("image", new File(["test-image"], "knee.png", { type: "image/png" }));
    data.append("declared_side", "unknown");
    const image = await casesApi.uploadImage("test-case", data, () => {});
    return { id: image.id };
  });
  expect(result.id).toBe("uploaded");
  expect(uploads).toBe(2);
});

test("public authentication errors never trigger session refresh", async ({ page }) => {
  let refreshes = 0;
  await page.route("**/api/v1/auth/token/refresh/", (route) => {
    refreshes++;
    return route.fulfill({ json: { access: "renewed-access" } });
  });
  await page.route("**/api/v1/auth/otp/verify/", (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ status: 401, json: { errors: { detail: "Invalid credentials" } } });
  });
  await startSession(page);
  const status = await page.evaluate(async () => {
    const modulePath = "/src/api/client.ts";
    const { authApi } = await import(modulePath);
    try { await authApi.verifyOtp({ phone_number: "09123456789", code: "00000" }); }
    catch (error) { return (error as { status: number }).status; }
  });
  expect(status).toBe(401);
  expect(refreshes).toBe(0);
});
