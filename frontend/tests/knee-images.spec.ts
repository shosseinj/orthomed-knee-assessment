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
  };
}

test("four slots upload independently, require confirmation, and show captions in locked review", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/cases/${id}`);
  await expect(page.locator(".knee-slot")).toHaveCount(4);
  for (const slot of ["right_frontal", "right_lateral", "left_frontal", "left_lateral"]) {
    const section = page.locator(`[data-slot="${slot}"]`);
    await section.locator('input[type="file"]').setInputFiles(file);
    await expect(section.getByText("Independent AI detection:", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeDisabled();
    await section.getByRole("button", { name: "Confirm image assignment", exact: true }).click();
    await expect(section.getByText("Human confirmation:", { exact: false })).toBeVisible();
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

test("unilateral uncertain image supports acknowledged unknown, Persian RTL and mobile", async ({ page }) => {
  const state = await setup(page);
  state.detect({ detected_side: "unknown", detected_view: "unknown", quality_status: "limited", visible_marker: "none", classification_reason: "No marker; view obscured." });
  await page.goto(`/cases/${id}`);
  const slot = page.locator('[data-slot="right_frontal"]');
  await slot.locator('input[type="file"]').setInputFiles(file);
  await expect(slot).toContainText("Knee side unknown");
  await slot.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("unknown");
  await slot.getByRole("combobox", { name: "Image view", exact: true }).selectOption("unknown");
  await expect(slot.getByRole("button", { name: "Confirm image assignment" })).toBeDisabled();
  await slot.getByLabel("Confirmation reason / note").fill("Laterality and view need specialist review.");
  await slot.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(page.locator(".knee-unassigned .knee-image")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".knee-caption strong").first()).toContainText("عکس ۱: نمای نامشخص — سمت زانو نامشخص");
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
  await expect(slot).toContainText("Declared at upload: Frontal — Right knee");
  await expect(slot).toContainText("Independent AI detection: Lateral — Left knee");
  expect(state.images()[0].slot_key).toBe("right_frontal");
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
  await expect(right).toContainText("Independent AI detection");
  state.detect({ detected_side: "bilateral", visible_marker: "both" });
  const left = page.locator('[data-slot="left_frontal"]');
  await left.locator('input[type="file"]').setInputFiles(file);
  await expect(left).toContainText("Both knees");
  await left.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("right");
  await left.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(left.getByRole("alert")).toContainText("This slot is occupied");
  await left.getByRole("combobox", { name: "Knee side", exact: true }).selectOption("bilateral");
  await left.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(page.locator(".knee-unassigned .knee-image")).toHaveCount(1);
  await expect(page.locator(".knee-unassigned")).toContainText("Human confirmation: Frontal — Both knees");
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
  await expect(slot).toContainText("Independent AI detection");
  await slot.getByRole("button", { name: "Confirm image assignment" }).click();
  await expect(slot).toContainText("Human confirmation");
  await slot.getByLabel("Replace image — Frontal — Right knee", { exact: true }).setInputFiles(file);
  await expect(slot.locator(".knee-image")).toHaveAttribute("data-image-id", "image-2");
  await expect(slot.getByText("Human confirmation:", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeDisabled();
  expect(state.uploads[1]).toContain('name="replace_image_id"\r\n\r\nimage-1');
  await slot.getByRole("button", { name: "Delete image 1", exact: true }).click();
  await expect(page.locator(".knee-image")).toHaveCount(0);
});

test("legacy images retain unknown captions and preserve the existing submission minimum", async ({ page }) => {
  await setup(page, [{ id: "legacy", view: "ap", image_url: "/api/v1/images/legacy/file/", purpose: "xray", uploaded_at: "2026-10-20T12:00:00Z" }]);
  await page.goto(`/cases/${id}`);
  await expect(page.locator(".knee-unassigned")).toContainText("Legacy image; unclassified");
  await expect(page.locator(".knee-caption strong")).toContainText("Unknown view — Knee side unknown");
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "فارسی", exact: true }).click();
  await expect(page.locator(".knee-unassigned")).toContainText("تصویر قدیمی؛ طبقه‌بندی نشده");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
