import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const token = "12345678-1234-4234-8234-123456789012";
const caseId = "aaaaaaaa-1234-4234-8234-123456789012";
const patient = {
  id: "patient-1",
  phone_number: "09123456789",
  first_name: "Sara",
  last_name: "Test",
  full_name: "Sara Test",
  role: "patient",
  is_verified: true,
  birth_date: "1990-01-01",
};
const doctor = {
  ...patient,
  id: "doctor-1",
  role: "doctor",
  full_name: "Dr. Test",
  medical_council_number: "1234",
};
const bookingDay = new Date(Date.now() + 7 * 86400000)
  .toISOString()
  .slice(0, 10);
const appointment = {
  id: "visit-1",
  doctor,
  patient,
  phone_number: patient.phone_number,
  scheduled_at: `${bookingDay}T12:00:00+03:30`,
  source: "doctor",
  status: "scheduled",
  status_label: "رزروشده",
  case_id: caseId,
};
const record = {
  id: caseId,
  title: "ارزیابی جراحی زانو",
  patient,
  managing_doctor: doctor,
  status: "draft",
  status_label: "پیش‌نویس",
  can_edit_intake: true,
  can_review: false,
  can_request_ai: false,
  can_delete_draft: false,
  created_at: "2026-11-21T12:00:00Z",
  images: [],
  assessments: [],
};
const png =
  "data:image/png;base64," +
  readFileSync(new URL("./fixtures/doctor-qr.png", import.meta.url)).toString(
    "base64",
  );

async function language(page: Page, signedIn = false) {
  await page.addInitScript((signedIn) => {
    localStorage.setItem("orthomed_language", "en");
    if (signedIn) localStorage.setItem("orthomed_access", "test-token");
  }, signedIn);
}

for (const existing of [true, false]) {
  test(`QR doctor survives ${existing ? "sign-in" : "registration"} and only explicit confirmation admits patient`, async ({
    page,
  }) => {
    await language(page);
    let admissions = 0;
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes("/reception/")) {
        if (route.request().method() === "POST") {
          admissions++;
          return route.fulfill({ json: appointment });
        }
        return route.fulfill({ json: { doctor } });
      }
      if (path.endsWith("/otp/request/"))
        return route.fulfill({ json: { is_mock: false } });
      if (path.endsWith("/otp/verify/")) {
        expect(route.request().postDataJSON().entry_role).toBe("patient");
        return route.fulfill({
          json: existing
            ? {
                registration_required: false,
                access: "access",
                refresh: "refresh",
                user: patient,
              }
            : {
                registration_required: true,
                registration_token: "registration",
              },
        });
      }
      if (path.endsWith("/register/"))
        return route.fulfill({
          json: { access: "access", refresh: "refresh", user: patient },
        });
      if (path.endsWith("/auth/me/")) return route.fulfill({ json: patient });
      return route.fulfill({ json: record });
    });
    await page.goto(`/check-in/${token}`);
    await expect(page.getByRole("heading", { name: "Dr. Test" })).toBeVisible();
    await page
      .getByRole("link", { name: "Patient sign-in or registration" })
      .click();
    await expect(
      page.getByRole("radio", { name: "Patient", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Doctor", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Mobile number", { exact: true })
      .fill(patient.phone_number);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Verification code", { exact: true }).fill("54321");
    await page
      .getByRole("button", { name: "Verify and continue", exact: true })
      .click();
    if (!existing) {
      await page.getByLabel("First name", { exact: true }).fill("Sara");
      await page.getByLabel("Last name", { exact: true }).fill("Test");
      await page.getByLabel("National ID").fill("0013520822");
      await page
        .getByLabel("Date of birth", { exact: true })
        .fill("1990-01-01");
      await page
        .getByRole("button", { name: "Register and sign in", exact: true })
        .click();
    }
    await expect(page).toHaveURL(`/check-in/${token}`);
    expect(admissions).toBe(0);
    await page
      .getByRole("button", { name: "Start check-in and questionnaire" })
      .click();
    await expect(page).toHaveURL(`/cases/${caseId}`);
    await expect(page.locator(".intake-wizard")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete draft", exact: true }),
    ).toHaveCount(0);
    expect(admissions).toBe(1);
  });
}

test("doctor books a new patient, reschedules and cancels in Tehran time", async ({
  page,
}) => {
  await language(page, true);
  let items: (Omit<typeof appointment, "patient" | "case_id"> & {
    patient: typeof patient | null;
    case_id: string | null;
  })[] = [];
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/me/")) return route.fulfill({ json: doctor });
    if (request.method() === "POST" && path.endsWith("/appointments/")) {
      const data = request.postDataJSON();
      expect(data.phone_number).toBe("09123456789");
      expect(data.scheduled_at).toBe(`${bookingDay}T14:30:00+03:30`);
      items = [{ ...appointment, ...data, patient: null, case_id: null }];
      return route.fulfill({ status: 201, json: items[0] });
    }
    if (request.method() === "PATCH") {
      items = [
        {
          ...items[0],
          ...request.postDataJSON(),
          status_label:
            request.postDataJSON().status === "cancelled"
              ? "لغوشده"
              : "رزروشده",
        },
      ];
      return route.fulfill({ json: items[0] });
    }
    return route.fulfill({
      json: { count: items.length, results: items, next: null },
    });
  });
  await page.goto("/appointments");
  await page.getByLabel("Patient phone number").fill("09123456789");
  await page.getByLabel("Appointment date", { exact: true }).fill(bookingDay);
  await page
    .getByLabel("Appointment time (Tehran)", { exact: true })
    .fill("14:30");
  await page
    .getByRole("button", { name: "Book appointment", exact: true })
    .click();
  await expect(
    page.getByText("Waiting for patient registration", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  await page
    .locator(".reschedule-form")
    .getByLabel("Appointment time (Tehran)")
    .fill("15:45");
  await page.getByRole("button", { name: "Save time", exact: true }).click();
  await expect
    .poll(() => items[0].scheduled_at)
    .toBe(`${bookingDay}T15:45:00+03:30`);
  await page
    .getByRole("button", { name: "Cancel appointment", exact: true })
    .click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reschedule", exact: true }),
  ).toHaveCount(0);
});

test("QR download, disable, replacement and printable mobile layout", async ({
  page,
}, testInfo) => {
  await language(page, true);
  let qr = {
    token,
    is_active: true,
    doctor,
    url: `https://orthomed.example/check-in/${token}`,
    image: png,
  };
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/auth/me/"))
      return route.fulfill({ json: doctor });
    if (route.request().method() === "PATCH")
      qr = { ...qr, ...route.request().postDataJSON() };
    if (route.request().method() === "POST")
      qr = {
        ...qr,
        is_active: true,
        token: "replacement",
        url: "https://orthomed.example/check-in/replacement",
      };
    return route.fulfill({ json: qr });
  });
  await page.goto("/doctor-qr");
  await expect(page.locator(".qr-print")).toContainText("Dr. Test");
  await expect(
    page.getByRole("link", { name: "Download PNG" }),
  ).toHaveAttribute("download", "orthomed-reception.png");
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(
    page.getByText("Check-in code is disabled.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replace code", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm new code", exact: true })
    .click();
  await expect(page.locator(".qr-url")).toContainText("replacement");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: testInfo.outputPath("qr-mobile.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  expect(
    await page
      .locator(".qr-print")
      .evaluate((el) => getComputedStyle(el).visibility),
  ).toBe("visible");
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).visibility),
  ).toBe("hidden");
});

test("history opens other doctor's submitted case without editing or AI tools", async ({
  page,
}) => {
  await language(page, true);
  const historyCase = {
    ...record,
    managing_doctor: {
      ...doctor,
      id: "other-doctor",
      full_name: "Other Doctor",
    },
    status: "submitted",
    status_label: "در انتظار بررسی",
    can_edit_intake: false,
    can_review: false,
    can_request_ai: false,
  };
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/auth/me/"))
      return route.fulfill({ json: doctor });
    if (route.request().url().includes("/patient-history/"))
      return route.fulfill({
        json: { patient, results: [historyCase], count: 1, next: null },
      });
    return route.fulfill({ json: historyCase });
  });
  await page.goto("/patients/patient-1/history");
  await page.locator(".history-row").click();
  await expect(
    page.getByText("This case belongs to a visit with another doctor", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".intake-wizard")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Get AI assessment", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".doctor-form")).toHaveCount(0);
});

test("wrong role and invalid QR cannot start check-in", async ({ page }) => {
  await language(page, true);
  let valid = true;
  let admissions = 0;
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/auth/me/"))
      return route.fulfill({ json: doctor });
    if (route.request().method() === "POST") admissions++;
    return valid
      ? route.fulfill({ json: { doctor } })
      : route.fulfill({
          status: 404,
          json: { errors: { detail: "Invalid code" } },
        });
  });
  await page.goto(`/check-in/${token}`);
  await expect(
    page.getByRole("button", { name: "Sign out and sign in as a patient" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start check-in and questionnaire" }),
  ).toHaveCount(0);
  valid = false;
  await page.goto(`/check-in/${token}`);
  await expect(page.getByRole("alert")).toContainText(
    "This check-in code is invalid or disabled.",
  );
  expect(admissions).toBe(0);
});

test("Persian mobile booking accepts a future calendar date", async ({
  page,
}, testInfo) => {
  const { choosePersianDate } = await import("./intake-helpers");
  await page.addInitScript(() => {
    localStorage.setItem("orthomed_language", "fa");
    localStorage.setItem("orthomed_access", "test-token");
  });
  let submitted: { scheduled_at: string } | null = null;
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().endsWith("/auth/me/"))
      return route.fulfill({ json: doctor });
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: appointment });
    }
    return route.fulfill({ json: { results: [], count: 0, next: null } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/appointments");
  const target = new Date(Date.now() + 2 * 86400000);
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(target);
  const part = (key: string) =>
    Number(parts.find((item) => item.type === key)?.value);
  await choosePersianDate(
    page,
    "تاریخ مراجعه",
    part("year"),
    part("month"),
    part("day"),
  );
  const gregorian = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
  await page.getByLabel("شماره موبایل بیمار").fill(patient.phone_number);
  await page.getByLabel("ساعت مراجعه (تهران)").fill("14:30");
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().left >= window.innerWidth),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("appointments-persian-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "ثبت نوبت", exact: true }).click();
  await expect
    .poll(() => submitted?.scheduled_at)
    .toBe(`${gregorian}T14:30:00+03:30`);
});

test("patient dashboard discovers newly booked questionnaires on returning to the app", async ({
  page,
}) => {
  await language(page, true);
  let appointments: (typeof appointment)[] = [];
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me/")) return route.fulfill({ json: patient });
    if (path.endsWith("/appointments/"))
      return route.fulfill({
        json: { results: appointments, count: appointments.length, next: null },
      });
    if (path.endsWith(`/cases/${caseId}/`))
      return route.fulfill({ json: record });
    return route.fulfill({ json: { results: [], count: 0, next: null } });
  });
  await page.goto("/dashboard");
  await expect(
    page.getByText(
      "To get started, scan your doctor's QR code or ask your doctor to book an appointment.",
      { exact: true },
    ),
  ).toBeVisible();
  appointments = [appointment];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".patient-appointments")).toContainText("Dr. Test");
  await page
    .getByRole("link", { name: "Complete questionnaire", exact: true })
    .click();
  await expect(page).toHaveURL(`/cases/${caseId}`);
});
