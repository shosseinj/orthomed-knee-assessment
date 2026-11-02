import { expect, test, type Page } from "@playwright/test";
import type { KneeSide, KneeView, XRayImage } from "../src/types";

const id = "12345678-1234-1234-1234-123456789012";
const patient = { id: "patient-1", role: "patient", is_verified: true, first_name: "Alex", last_name: "Patient", full_name: "Alex Patient", phone_number: "09120000001" };
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const file = { name: "knee.png", mimeType: "image/png", buffer: bytes };
const questionnaire = { age_years: 65, gender: "female", underlying_conditions: [], medications: [], height_cm: "170", weight_kg: "75", pain_level: 0, pain_duration_months: 12, mobility_limit: "none", previous_treatments: [], conservative_treatment_rounds: 0, conservative_duration_months: 0, conservative_response: "not_tried", had_intra_articular_injection: false, injection_rounds: 0, injection_types: [], daily_life_impact: "none", smoking_status: "never", diabetes_status: "none", has_night_pain: false, uses_walking_aid: false, additional_notes: "" };
const womac = { responses: {}, supplemental_responses: {}, pain_score: 0, stiffness_score: 0, function_score: 0, total_score: 0, normalized_score: "0", health_score: 100 };

async function setup(page: Page, initial: XRayImage[] = []) {
  await page.addInitScript(() => {
    localStorage.setItem("orthomed_access", "test-token");
    localStorage.setItem("orthomed_language", "en");
  });
  let images = initial;
  let sequence = 0;
  let status = "draft";
  let nextDetection: Partial<XRayImage> = {};
  let failNext = false;
  let holdUpload: Promise<void> | null = null;
  let releaseUpload = () => {};
  let holdClassification: Promise<void> | null = null;
  let releaseClassification = () => {};
  const classifications: string[] = [];
  const uploads: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/auth/me/")) return route.fulfill({ json: patient });
    if (path.endsWith("/file/")) {
      expect(req.headers()["authorization"]).toBe("Bearer test-token");
      return route.fulfill({ contentType: "image/png", body: bytes });
    }
    if (path === `/api/v1/cases/${id}/images/`) {
      const body = req.postDataBuffer()!.toString();
      uploads.push(body);
      const field = (name: string) => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]+)`))?.[1];
      const side = field("declared_side") as KneeSide;
      const view = field("declared_view") as KneeView;
      const replacement = field("replace_image_id");
      const slot = ["right", "left"].includes(side) && ["frontal", "lateral"].includes(view) ? `${side}_${view}` : null;
      if (images.some((row) => row.slot_key === slot && slot && row.id !== replacement)) return route.fulfill({ status: 400, json: { errors: { slot_key: "This slot is occupied. Use Replace or choose another slot." } } });
      const image: XRayImage = { id: `image-${++sequence}`, image_url: `/api/v1/images/image-${sequence}/file/`, purpose: "xray", view: "other", uploaded_at: "2026-10-28T12:00:00Z", organized: true, declared_side: side, declared_view: view, effective_side: side, effective_view: view, detected_side: "unknown", detected_view: "unknown", classification_status: "pending", slot_key: slot };
      if (holdUpload) await holdUpload;
      images = images.filter((row) => row.id !== replacement).concat(image);
      return route.fulfill({ status: 201, json: image });
    }
    const imageId = path.match(/\/images\/([^/]+)\//)?.[1];
    const image = images.find((row) => row.id === imageId);
    if (path.endsWith("/classify/") && image) {
      classifications.push(image.id);
      if (holdClassification) await holdClassification;
      if (failNext) {
        failNext = false;
        Object.assign(image, { classification_status: "failed", classification_error: "provider_unavailable" });
        return route.fulfill({ status: 503, json: image });
      }
      Object.assign(image, { detected_side: image.declared_side, detected_view: image.declared_view, visible_marker: image.declared_side === "right" ? "R" : "L", quality_status: "adequate", is_knee_xray: true, classification_reason: "Visible marker and projection anatomy.", classified_at: "2026-10-28T12:01:00Z", classification_error: "", classification_model: "Mock provider", classification_version: "test-only", ...nextDetection });
      nextDetection = {};
      image.classification_status = image.detected_side !== image.declared_side || image.detected_view !== image.declared_view ? "needs_confirmation" : "completed";
      return route.fulfill({ json: image });
    }
    if (path.endsWith("/confirm/") && image) {
      const { side, view, reason } = req.postDataJSON();
      const slot = ["right", "left"].includes(side) && ["frontal", "lateral"].includes(view) ? `${side}_${view}` : null;
      if (slot && images.some((row) => row.id !== image.id && row.slot_key === slot)) return route.fulfill({ status: 400, json: { errors: { slot_key: "This slot is occupied. Use Replace or choose another slot." } } });
      Object.assign(image, { confirmed_side: side, confirmed_view: view, effective_side: side, effective_view: view, confirmed_at: "2026-10-28T12:02:00Z", confirmation_reason: reason, confirmed_by: patient.id, confirmation_source: "manual", classification_status: "completed", slot_key: slot });
      return route.fulfill({ json: image });
    }
    if (image && req.method() === "DELETE") {
      images = images.filter((row) => row.id !== image.id);
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/submit/")) status = "submitted";
    return route.fulfill({ json: { id, patient, title: "ارزیابی جراحی زانو", status, status_label: status === "draft" ? "پیش‌نویس" : "در انتظار بررسی", can_edit_intake: status === "draft", created_at: "2026-10-28T12:00:00Z", questionnaire, womac, images, assessments: [] } });
  });
  return { images: () => images, classifications, uploads,
    detect: (value: Partial<XRayImage>) => { nextDetection = value; },
    fail: () => { failNext = true; },
    hold: () => { holdUpload = new Promise<void>((resolve) => { releaseUpload = resolve; }); },
    release: () => { releaseUpload(); holdUpload = null; },
    holdClassification: () => { holdClassification = new Promise<void>((resolve) => { releaseClassification = resolve; }); },
    releaseClassification: () => { releaseClassification(); holdClassification = null; },
  };
}

test("four slots upload independently, require confirmation, and show captions in locked review", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/cases/${id}`);
  await expect(page.locator(".knee-slot")).toHaveCount(4);
  for (const slot of ["right_frontal", "right_lateral", "left_frontal", "left_lateral"]) {
    const section = page.locator(`[data-slot="${slot}"]`);
    await section.locator('input[type="file"]').setInputFiles(file);
    await expect(section.getByLabel("Confirmation reason / note")).toHaveValue("Visible marker and projection anatomy.");
    await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeDisabled();
    await section.getByRole("button", { name: "Confirm image assignment", exact: true }).click();
    await expect(section.locator(".knee-confirmed")).toBeVisible();
  }
  expect(state.classifications).toEqual(["image-1", "image-2", "image-3", "image-4"]);
  expect(state.images().map((image) => image.slot_key)).toEqual(["right_frontal", "right_lateral", "left_frontal", "left_lateral"]);
  expect(state.uploads[0]).not.toContain('name="view"');
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeEnabled();
  await page.screenshot({ path: "/tmp/orthomed-knees-en.png", fullPage: true });
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("button", { name: "Confirm and submit", exact: true }).click();
  await expect(page.locator(".xray-gallery figure")).toHaveCount(4);
  await expect(page.locator(".xray-gallery")).toContainText("Image 3: Frontal — Left knee");
  await expect(page.getByRole("button", { name: "Confirm image assignment" })).toHaveCount(0);
});

test("successful submission displays the returned case without another protected read", async ({ page }) => {
  await setup(page, [{ id: "confirmed", image_url: "/api/v1/images/confirmed/file/", purpose: "xray", view: "other", uploaded_at: "2026-10-28T12:00:00Z",
    organized: true, declared_side: "right", declared_view: "frontal", effective_side: "right", effective_view: "frontal",
    confirmed_side: "right", confirmed_view: "frontal", confirmed_at: "2026-10-28T12:02:00Z", slot_key: "right_frontal", classification_status: "completed" }]);
  let submitted = false;
  let additionalReads = 0;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/submit/")) submitted = true;
    if (submitted && path === `/api/v1/cases/${id}/` && route.request().method() === "GET") {
      additionalReads++;
      return route.fulfill({ status: 401, json: { errors: { code: "token_not_valid" } } });
    }
    return route.fallback();
  });
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("button", { name: "Confirm and submit", exact: true }).click();
  await expect(page.locator(".patient-review-notice")).toBeVisible();
  await expect(page.locator(".xray-gallery figure")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(additionalReads).toBe(0);
});

test("unilateral uncertain image supports acknowledged unknown, Persian RTL and mobile", async ({ page }) => {
  const state = await setup(page);
  state.detect({ detected_side: "unknown", detected_view: "unknown", quality_status: "limited", visible_marker: "none", classification_reason: "No marker; view obscured." });
  await page.goto(`/cases/${id}`);
  const slot = page.locator('[data-slot="right_frontal"]');
  await slot.locator('input[type="file"]').setInputFiles(file);
  await expect(slot).toContainText("Knee side unknown");
  await slot.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("unknown");
  await slot.getByRole("combobox", { name: "Image view", exact: true }).selectOption("unknown");
  await expect(slot.getByLabel("Confirmation reason / note")).toHaveValue("No marker; view obscured.");
  await slot.getByLabel("Confirmation reason / note").fill("");
  await expect(slot.getByRole("button", { name: "Confirm image assignment" })).toBeDisabled();
  await slot.getByLabel("Confirmation reason / note").fill("Laterality and view need specialist review.");
  await slot.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(page.locator(".knee-unassigned .knee-image")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".knee-confirmation").getByRole("combobox", { name: "سمت زانو", exact: true })).toHaveValue("unknown");
  await expect(page.locator(".knee-confirmation").getByRole("combobox", { name: "نمای تصویر", exact: true })).toHaveValue("unknown");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/orthomed-knees-mobile-fa.png", fullPage: true, animations: "disabled" });
});

test("slot conflict shows both sources and moves only after explicit correction", async ({ page }) => {
  const state = await setup(page);
  state.detect({ detected_side: "left", detected_view: "lateral", visible_marker: "L" });
  await page.goto(`/cases/${id}`);
  const slot = page.locator('[data-slot="right_frontal"]');
  await slot.locator('input[type="file"]').setInputFiles(file);
  await expect(slot).toContainText("AI detection differs from the selected slot");
  expect(state.images()[0].declared_side).toBe("right");
  expect(state.images()[0].declared_view).toBe("frontal");
  expect(state.images()[0].slot_key).toBe("right_frontal");
  await expect(slot.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("left");
  await expect(slot.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("lateral");
  await slot.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("left");
  await slot.getByRole("combobox", { name: "Image view", exact: true }).selectOption("lateral");
  await slot.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(page.locator('[data-slot="left_lateral"] .knee-image')).toHaveCount(1);
  expect(state.images()[0].declared_side).toBe("right");
  expect(state.images()[0].confirmed_side).toBe("left");
});

test("bilateral image stays available for review and duplicate correction reports an error", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/cases/${id}`);
  const right = page.locator('[data-slot="right_frontal"]');
  await right.locator('input[type="file"]').setInputFiles(file);
  await expect(right.getByLabel("Confirmation reason / note")).toHaveValue("Visible marker and projection anatomy.");
  state.detect({ detected_side: "bilateral", visible_marker: "both" });
  const left = page.locator('[data-slot="left_frontal"]');
  await left.locator('input[type="file"]').setInputFiles(file);
  await expect(left.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("bilateral");
  await left.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("right");
  await left.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(left.getByRole("alert")).toContainText("This slot is occupied");
  await left.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("bilateral");
  await left.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(page.locator(".knee-unassigned .knee-image")).toHaveCount(1);
  await expect(page.locator(".knee-unassigned .knee-confirmed")).toBeVisible();
  await expect(page.locator(".knee-unassigned").getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("bilateral");
  expect(state.images()).toHaveLength(2);
});

test("provider failure retains preview and offers retry, replacement, progress, and removal", async ({ page }) => {
  const state = await setup(page);
  state.fail(); state.hold();
  await page.goto(`/cases/${id}`);
  const slot = page.locator('[data-slot="right_frontal"]');
  await slot.locator('input[type="file"]').setInputFiles(file);
  await expect(slot.getByRole("progressbar")).toBeVisible();
  state.release();
  await expect(slot.getByRole("alert")).toContainText("Your image is retained");
  await expect(slot.locator("img")).toHaveAttribute("src", /^blob:/);
  await slot.getByRole("button", { name: "Classify / retry" }).click();
  await expect(slot.getByLabel("Confirmation reason / note")).toHaveValue("Visible marker and projection anatomy.");
  await slot.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(slot).toContainText("Human confirmation");
  await slot.getByLabel("Replace image — Frontal — Right knee", { exact: true }).setInputFiles(file);
  await expect(slot.locator(".knee-image")).toHaveAttribute("data-image-id", "image-2");
  await expect(slot.locator(".knee-confirmed")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeDisabled();
  expect(state.uploads[1]).toContain('name="replace_image_id"\r\n\r\nimage-1');
  await slot.getByRole("button", { name: "Delete image 1", exact: true }).click();
  await expect(page.locator(".knee-image")).toHaveCount(0);
});

test("legacy images retain unknown captions and preserve the existing submission minimum", async ({ page }) => {
  await setup(page, [{ id: "legacy", view: "ap", image_url: "/api/v1/images/legacy/file/", purpose: "xray", uploaded_at: "2026-10-20T12:00:00Z" }]);
  await page.goto(`/cases/${id}`);
  await expect(page.locator(".knee-unassigned")).toContainText("Legacy image; unclassified");
  await expect(page.locator(".knee-unassigned").getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("unknown");
  await expect(page.locator(".knee-unassigned").getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("unknown");
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await expect(page.locator(".knee-unassigned")).toContainText("تصویر قدیمی؛ طبقه‌بندی نشده");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

for (const side of ["right", "left", "bilateral"] as const) {
  test(`direct upload fills ${side} from the model without asking for a side first`, async ({ page }) => {
    const state = await setup(page);
    state.detect({ detected_side: side, detected_view: "frontal", visible_marker: side === "right" ? "R" : side === "left" ? "L" : "both" });
    await page.goto(`/cases/${id}`);
    const uploader = page.locator(".knee-unassigned-upload");
    await expect(uploader.getByRole("combobox")).toHaveCount(0);
    await expect(uploader.locator('input[type="file"]')).toBeEnabled();
    await uploader.locator('input[type="file"]').setInputFiles(file);
    const image = page.locator('[data-image-id="image-1"]');
    await expect(image.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue(side);
    await expect(image.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("frontal");
    expect(state.images()[0].declared_side).toBe("unknown");
    expect(state.images()[0].declared_view).toBe("unknown");
    expect(state.classifications).toEqual(["image-1"]);
    await image.getByRole("button", { name: "Confirm image assignment", exact: true }).click();
    await page.reload();
    await expect(image.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue(side);
    expect(state.images()[0].confirmed_side).toBe(side);
    expect(state.images()[0].detected_side).toBe(side);
    await expect(uploader.locator('input[type="file"]')).toBeEnabled();
  });
}

for (const language of ["en", "fa"]) {
  test(`unmarked images upload directly and prefill the detected view and evidence without inventing laterality in ${language}`, async ({ page }) => {
    const state = await setup(page);
    const reason = "Frontal knee anatomy is visible. No R/L marker is present, so laterality is unknown.";
    state.detect({ detected_side: "unknown", detected_view: "frontal", visible_marker: "none", classification_reason: reason });
    await page.goto(`/cases/${id}`);
    if (language === "fa") {
      await page.getByRole("button", { name: "فارسی", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
    }
    const section = page.locator(".knee-unassigned");
    await section.locator('input[type="file"]').first().setInputFiles(file);
    const fields = section.locator(".knee-confirmation");
    await expect(fields.locator("select").nth(0)).toHaveValue("unknown");
    await expect(fields.locator("select").nth(1)).toHaveValue("frontal");
    await expect(fields.locator("textarea")).toHaveValue(reason);
    await expect(fields.locator("textarea")).toHaveAttribute("dir", "auto");
    await expect(section.locator(".knee-warning").filter({ hasText: "AI detection differs from the selected slot" })).toHaveCount(0);
    await expect(section.locator(".knee-warning").filter({ hasText: "تشخیص مدل با جایگاه انتخابی متفاوت است" })).toHaveCount(0);
    expect(state.images()[0].declared_side).toBe("unknown");
    expect(state.images()[0].detected_side).toBe("unknown");
    expect(state.images()[0].declared_view).toBe("unknown");
    await expect(section.locator(".knee-unassigned-upload select")).toHaveCount(0);
    await expect(section.locator('input[type="file"]').first()).toBeEnabled();
    expect(state.images()[0].confirmed_at).toBeUndefined();
    expect(state.images()[0].slot_key).toBeNull();
    const confirm = fields.getByRole("button", { name: language === "fa" ? "تأیید جایگاه تصویر" : "Confirm image assignment", exact: true });
    await expect(confirm).toBeEnabled();
    await expect(page.getByRole("button", { name: language === "fa" ? "ارسال برای بررسی" : "Submit for review", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (language === "fa") await section.locator(".knee-image").screenshot({ path: "/tmp/orthomed-ai-prefill-fa.png" });
    await confirm.click();
    await expect(section.locator(".knee-confirmed")).toBeVisible();
    expect(state.images()[0].confirmed_side).toBe("unknown");
    expect(state.images()[0].confirmed_view).toBe("frontal");
    expect(state.images()[0].confirmation_reason).toBe(reason);
  });
}

test("late AI responses preserve in-flight edits and an explicit retry applies the fresh GPT result", async ({ page }) => {
  const state = await setup(page);
  state.holdClassification();
  state.detect({ detected_side: "right", detected_view: "lateral", visible_marker: "R" });
  await page.goto(`/cases/${id}`);
  const section = page.locator(".knee-unassigned");
  await section.locator('input[type="file"]').first().setInputFiles(file);
  await expect(section.getByRole("status")).toContainText("Classifying");
  await section.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("left");
  await section.getByLabel("Confirmation reason / note").fill("My manual correction must be preserved.");
  state.releaseClassification();
  await expect.poll(() => state.images()[0].detected_side).toBe("right");
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("left");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("lateral");
  await expect(section.getByLabel("Confirmation reason / note")).toHaveValue("My manual correction must be preserved.");
  state.detect({ detected_side: "bilateral", detected_view: "frontal", visible_marker: "both", classification_reason: "Updated AI evidence." });
  await section.getByRole("button", { name: "Classify / retry", exact: true }).click();
  await expect.poll(() => state.images()[0].detected_side).toBe("bilateral");
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("bilateral");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("frontal");
  await expect(section.getByLabel("Confirmation reason / note")).toHaveValue("Updated AI evidence.");
  expect(state.images()[0].confirmed_at).toBeUndefined();
});

test("saved human confirmation takes precedence over AI suggestions and later classification retries", async ({ page }) => {
  const state = await setup(page, [{ id: "confirmed", view: "other", image_url: "/api/v1/images/confirmed/file/", purpose: "xray", uploaded_at: "2026-10-28T12:00:00Z", organized: true,
    declared_side: "unknown", declared_view: "unknown", detected_side: "right", detected_view: "frontal", classified_at: "2026-10-28T12:01:00Z", classification_reason: "AI evidence.",
    confirmed_side: "left", confirmed_view: "lateral", confirmation_reason: "Reviewed by the user.", confirmed_at: "2026-10-28T12:02:00Z", effective_side: "left", effective_view: "lateral", slot_key: "left_lateral", classification_status: "completed" }]);
  await page.goto(`/cases/${id}`);
  const section = page.locator('[data-slot="left_lateral"]');
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("left");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("lateral");
  await expect(section.getByLabel("Confirmation reason / note")).toHaveValue("Reviewed by the user.");
  state.detect({ detected_side: "bilateral", detected_view: "skyline", visible_marker: "both" });
  await section.getByRole("button", { name: "Classify / retry", exact: true }).click();
  await expect.poll(() => state.images()[0].detected_view).toBe("skyline");
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("left");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("lateral");
  await expect(section.getByLabel("Confirmation reason / note")).toHaveValue("Reviewed by the user.");
});

test("existing classifications prefill on page load and long evidence fits the confirmation limit", async ({ page }) => {
  const reason = "Detailed AI image evidence. ".repeat(30);
  await setup(page, [{ id: "classified", view: "other", image_url: "/api/v1/images/classified/file/", purpose: "xray", uploaded_at: "2026-10-28T12:00:00Z", organized: true,
    declared_side: "unknown", declared_view: "unknown", detected_side: "left", detected_view: "skyline", classified_at: "2026-10-28T12:01:00Z", classification_reason: reason, classification_status: "needs_confirmation" }]);
  await page.goto(`/cases/${id}`);
  const section = page.locator(".knee-unassigned");
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("left");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("skyline");
  await expect(section.getByLabel("Confirmation reason / note")).toHaveValue(reason.slice(0, 500));
  await page.reload();
  await expect(section.getByLabel("Confirmation reason / note")).toHaveValue(reason.slice(0, 500));
});

test("long AI explanations remain readable without native field-sizing support", async ({ page }) => {
  const state = await setup(page);
  const reason = "Visible frontal knee anatomy; no reliable R/L marker, so the knee side requires confirmation. ".repeat(5);
  state.detect({ detected_side: "unknown", detected_view: "frontal", visible_marker: "none", classification_reason: reason });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(`/cases/${id}`);
  await page.addStyleTag({ content: ".knee-confirmation textarea { field-sizing: fixed !important; }" });
  const section = page.locator(".knee-unassigned");
  await section.locator('input[type="file"]').first().setInputFiles(file);
  const note = section.getByRole("textbox", { name: "Confirmation reason / note", exact: true });
  await expect(note).toHaveValue(reason);
  await expect.poll(() => note.evaluate((element) => element.scrollHeight <= element.clientHeight + 2 && element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  await page.setViewportSize({ width: 320, height: 1000 });
  await expect.poll(() => note.evaluate((element) => element.scrollHeight <= element.clientHeight + 2 && element.scrollWidth <= element.clientWidth + 2)).toBe(true);
});

test("a failed retry preserves the previous suggestion and manual edits", async ({ page }) => {
  const state = await setup(page);
  state.detect({ detected_side: "unknown", detected_view: "frontal", visible_marker: "none" });
  await page.goto(`/cases/${id}`);
  const section = page.locator(".knee-unassigned");
  await section.locator('input[type="file"]').first().setInputFiles(file);
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("frontal");
  await section.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("left");
  await section.getByLabel("Confirmation reason / note").fill("Manual note before a failed request.");
  state.fail();
  await section.getByRole("button", { name: "Classify / retry", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("Your image is retained");
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("left");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("frontal");
  await expect(section.getByLabel("Confirmation reason / note")).toHaveValue("Manual note before a failed request.");
});

test("unknown AI side and view retain the user's explicit upload assignment with source labels", async ({ page }) => {
  const state = await setup(page);
  const reason = "نشانگر قابل اطمینان و نمای استاندارد دیده نمی‌شود؛ سمت و نما نیازمند تأیید کاربر است.";
  state.detect({ detected_side: "unknown", detected_view: "unknown", quality_status: "limited", visible_marker: "none", classification_reason: reason });
  await page.goto(`/cases/${id}`);
  const section = page.locator('[data-slot="right_lateral"]');
  await section.locator('input[type="file"]').setInputFiles(file);
  await expect(section).toContainText("The form uses the side you selected at upload");
  await expect(section).toContainText("The form uses the view you selected at upload");
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("right");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("lateral");
  await expect(section.getByRole("textbox", { name: "Confirmation reason / note", exact: true })).toHaveValue(reason);
  expect(state.images()[0].detected_side).toBe("unknown");
  expect(state.images()[0].detected_view).toBe("unknown");
  expect(state.images()[0].confirmed_at).toBeUndefined();
  await section.getByRole("button", { name: "Confirm image assignment", exact: true }).click();
  await expect(section.locator(".knee-confirmed")).toBeVisible();
  expect(state.images()[0].confirmed_side).toBe("right");
  expect(state.images()[0].confirmed_view).toBe("lateral");
  expect(state.images()[0].detected_side).toBe("unknown");
});

test("non-knee or unusable AI results do not use the declared slot as a detected assignment", async ({ page }) => {
  const state = await setup(page);
  state.detect({ detected_side: "unknown", detected_view: "unknown", is_knee_xray: false, quality_status: "unusable", visible_marker: "none", classification_reason: "تصویر برای تشخیص زانو، سمت و نما قابل استفاده نیست." });
  await page.goto(`/cases/${id}`);
  const section = page.locator('[data-slot="right_frontal"]');
  await section.locator('input[type="file"]').setInputFiles(file);
  await expect(section).toContainText("AI did not identify this image as a knee X-ray");
  await expect(section.getByRole("combobox", { name: "Knee side", exact: true })).toHaveValue("unknown");
  await expect(section.getByRole("combobox", { name: "Image view", exact: true })).toHaveValue("unknown");
});

test("a detected side, view and Persian explanation fill the Persian form", async ({ page }) => {
  const state = await setup(page);
  const reason = "نمای رخ زانو و نشانگر R قابل مشاهده است؛ سمت راست و نمای رخ تشخیص داده می‌شود.";
  state.detect({ detected_side: "right", detected_view: "frontal", visible_marker: "R", classification_reason: reason });
  await page.goto(`/cases/${id}`);
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  const section = page.locator(".knee-unassigned");
  await section.locator('input[type="file"]').first().setInputFiles(file);
  await expect(section.getByRole("combobox", { name: "سمت زانو", exact: true })).toHaveValue("right");
  await expect(section.getByRole("combobox", { name: "نمای تصویر", exact: true })).toHaveValue("frontal");
  await expect(section.getByRole("textbox", { name: "دلیل / یادداشت تأیید", exact: true })).toHaveValue(reason);
});
