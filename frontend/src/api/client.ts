import { locale, t } from "../i18n";
const API_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

type ApiOptions = RequestInit & { authenticated?: boolean };

// A development proxy may receive absolute URLs using the backend's loopback
// host. Keep image requests on the browser's origin when using a relative API.
export function apiFileUrl(source: string): string {
  const url = new URL(source, new URL(API_URL, window.location.origin));
  return API_URL.startsWith("/") ? `${url.pathname}${url.search}` : url.href;
}


export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(t("خطایی در ارتباط با سرور رخ داد."));
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return t(fallback);
  function messages(value: unknown): string[] {
    if (typeof value === "string") return [t(value)];
    if (Array.isArray(value)) return value.flatMap(messages);
    if (value && typeof value === "object") return Object.values(value).flatMap(messages);
    return [];
  }
  return [...new Set(messages(error.body))].join(" ") || t(fallback);
}

export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return {};
  const data = error.body as Record<string, unknown>;
  const errors = data.errors && typeof data.errors === "object" ? data.errors : data;
  return Object.fromEntries(Object.entries(errors).flatMap(([key, value]) => {
    const messages = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : [];
    return messages.length ? [[key, messages.map((message) => t(message)).join(" ")]] : [];
  }));
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept-Language", locale());
  const isForm = options.body instanceof FormData;
  if (!isForm) headers.set("Content-Type", "application/json");
  const token = localStorage.getItem("orthomed_access");
  if (options.authenticated !== false && token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

type LoginResult = { access: string; refresh: string; user: import("../types").User };
type OTPVerificationResult = ({ registration_required: false } & LoginResult) | { registration_required: true; registration_token: string };

export const authApi = {
  managedAccounts: (params: URLSearchParams, signal?: AbortSignal) => api<import("../types").ManagedAccountList>(`/auth/management/accounts/?${params}`, { signal }),
  reviewAccount: (id: string, is_verified: boolean) => api<import("../types").ManagedAccount>(`/auth/management/accounts/${id}/`, { method: "PATCH", body: JSON.stringify({ is_verified }) }),
  aiSettings: () => api<import("../types").AISettingsStatus>("/auth/settings/ai/"),
  saveAiSettings: (openai_api_key: string) => api<import("../types").AISettingsStatus>("/auth/settings/ai/", { method: "PUT", body: JSON.stringify({ openai_api_key }) }),
  removeAiKey: () => api<import("../types").AISettingsStatus>("/auth/settings/ai/", { method: "DELETE" }),
  requestOtp: (phone_number: string) => api<{ detail: string; is_mock: boolean; development_code?: string }>("/auth/otp/request/", { method: "POST", body: JSON.stringify({ phone_number }), authenticated: false }),
  verifyOtp: (payload: Record<string, string>) => api<OTPVerificationResult>("/auth/otp/verify/", { method: "POST", body: JSON.stringify(payload), authenticated: false }),
  register: (payload: Record<string, string>) => api<LoginResult>("/auth/register/", { method: "POST", body: JSON.stringify(payload), authenticated: false }),
  me: () => api<import("../types").User>("/auth/me/"),
  recordAccess: (path: string) => api<void>("/auth/access/", {
    method: "POST",
    body: JSON.stringify({ path, client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "" }),
  }),
  updateProfile: (data: { first_name: string; last_name: string; birth_date: string }) => api<import("../types").User>("/auth/me/", { method: "PATCH", body: JSON.stringify(data) }),
};

export const casesApi = {
  list: () => api<import("../types").Paginated<import("../types").MedicalCase>>("/cases/"),
  get: (id: string) => api<import("../types").MedicalCase>(`/cases/${id}/`),
  create: (patient_id?: string) => api<import("../types").MedicalCase>("/cases/", { method: "POST", body: JSON.stringify(patient_id ? { patient_id } : {}) }),
  listMyPatients: () => api<import("../types").DoctorPatientAssignment[]>("/cases/my-patients/"),
  addMyPatient: (phone_number: string) => api<import("../types").DoctorPatientAssignment>("/cases/my-patients/", { method: "POST", body: JSON.stringify({ phone_number }) }),
  searchCatalog: (catalog: "diseases" | "medications", query: string, offset = 0, signal?: AbortSignal) => api<{ results: import("../types").CatalogOption[]; count: number; next_offset: number | null }>(`/catalogs/${catalog}/?q=${encodeURIComponent(query)}&limit=50&offset=${offset}`, { signal }),
  deleteCase: (id: string) => api<void>(`/cases/${id}/`, { method: "DELETE" }),
  saveQuestionnaire: (id: string, data: import("../types").Questionnaire) => api(`/cases/${id}/questionnaire/`, { method: "PUT", body: JSON.stringify(data) }),
  saveWomac: (id: string, responses: Record<string, number>, supplemental_responses: Record<string, number>) => api(`/cases/${id}/womac/`, { method: "PUT", body: JSON.stringify({ responses, supplemental_responses }) }),
  uploadImage: (id: string, data: FormData) => api(`/cases/${id}/images/`, { method: "POST", body: data }),
  deleteImage: (id: string) => api<void>(`/images/${id}/`, { method: "DELETE" }),
  requestAiAssessment: (id: string) => api<import("../types").Assessment>(`/cases/${id}/ai-assessment/`, { method: "POST", body: JSON.stringify({}) }),
  submit: (id: string) => api(`/cases/${id}/submit/`, { method: "POST", body: JSON.stringify({}) }),
  saveDoctorAssessment: (id: string, data: Record<string, unknown>) => api(`/cases/${id}/doctor-assessment/`, { method: "PUT", body: JSON.stringify(data) }),
  saveInsuranceDecision: (id: string, data: Record<string, unknown>) => api(`/cases/${id}/insurance-decision/`, { method: "PUT", body: JSON.stringify(data) }),
};
