import { locale, t } from "../i18n";
const API_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

type ApiOptions = RequestInit & { authenticated?: boolean };

type RefreshedSession = { previousRefresh: string; refresh: string; access: string };
let lastRefreshedSession: RefreshedSession | null = null;
let pendingRefresh: { refresh: string; promise: Promise<string | null> } | null = null;

async function refreshAccessToken(access: string | null, refresh: string | null): Promise<string | null> {
  if (!refresh) return null;
  const currentRefresh = localStorage.getItem("orthomed_refresh");
  const currentAccess = localStorage.getItem("orthomed_access");
  // Another request may already have refreshed this session. Never replay an
  // earlier user's request after a sign-out or a switch to another account.
  if (currentAccess !== access && lastRefreshedSession?.previousRefresh === refresh && lastRefreshedSession.refresh === currentRefresh
    && lastRefreshedSession.access === currentAccess) return currentAccess;
  if (currentRefresh !== refresh || currentAccess !== access) return null;
  if (pendingRefresh?.refresh === refresh) return pendingRefresh.promise;
  const promise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/token/refresh/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }),
      });
      if (!response.ok) return null;
      const tokens = await response.json();
      if (typeof tokens.access !== "string" || !tokens.access
        || (tokens.refresh !== undefined && (typeof tokens.refresh !== "string" || !tokens.refresh))) return null;
      if (localStorage.getItem("orthomed_refresh") !== refresh || localStorage.getItem("orthomed_access") !== access) return null;
      const nextRefresh = tokens.refresh ?? refresh;
      localStorage.setItem("orthomed_access", tokens.access);
      localStorage.setItem("orthomed_refresh", nextRefresh);
      lastRefreshedSession = { previousRefresh: refresh, refresh: nextRefresh, access: tokens.access };
      return tokens.access as string;
    } catch { return null; }
  })();
  pendingRefresh = { refresh, promise };
  try { return await promise; }
  finally { if (pendingRefresh?.promise === promise) pendingRefresh = null; }
}

export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const access = localStorage.getItem("orthomed_access");
  const refresh = localStorage.getItem("orthomed_refresh");
  const headers = new Headers(options.headers);
  if (access) headers.set("Authorization", `Bearer ${access}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status !== 401 || !access || options.signal?.aborted) return response;
  const nextAccess = await refreshAccessToken(access, refresh);
  if (!nextAccess || options.signal?.aborted) return response;
  headers.set("Authorization", `Bearer ${nextAccess}`);
  return fetch(url, { ...options, headers });
}

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
  const request = options.authenticated === false ? fetch : authenticatedFetch;
  const response = await request(`${API_URL}${path}`, { ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

function uploadCaseImage(id: string, data: FormData, onProgress?: (percent: number) => void, retry = true): Promise<import("../types").XRayImage> {
  if (!onProgress) return api(`/cases/${id}/images/`, { method: "POST", body: data });
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/cases/${id}/images/`);
    request.setRequestHeader("Accept-Language", locale());
    const token = localStorage.getItem("orthomed_access");
    const refresh = localStorage.getItem("orthomed_refresh");
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.responseType = "json";
    request.timeout = 120000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = async () => {
      if (request.status === 401 && token && retry && await refreshAccessToken(token, refresh)) {
        resolve(uploadCaseImage(id, data, onProgress, false));
      } else if (request.status >= 200 && request.status < 300) resolve(request.response);
      else reject(new ApiError(request.status, request.response));
    };
    request.onerror = request.ontimeout = () => reject(new Error("Upload failed"));
    request.send(data);
  });
}

type LoginResult = { access: string; refresh: string; user: import("../types").User };
type OTPVerificationResult = ({ registration_required: false } & LoginResult) | { registration_required: true; registration_token: string; registration_profile?: Partial<import("../types").User> };

export const authApi = {
  managedAccounts: (params: URLSearchParams, signal?: AbortSignal) => api<import("../types").ManagedAccountList>(`/auth/management/accounts/?${params}`, { signal }),
  reviewAccount: (id: string, is_verified: boolean) => api<import("../types").ManagedAccount>(`/auth/management/accounts/${id}/`, { method: "PATCH", body: JSON.stringify({ is_verified }) }),
  aiSettings: () => api<import("../types").AISettingsStatus>("/auth/settings/ai/"),
  saveAiSettings: (openai_api_key: string) => api<import("../types").AISettingsStatus>("/auth/settings/ai/", { method: "PUT", body: JSON.stringify({ openai_api_key }) }),
  removeAiKey: () => api<import("../types").AISettingsStatus>("/auth/settings/ai/", { method: "DELETE" }),
  requestOtp: (phone_number: string) => api<{ detail: string; is_mock: boolean; development_code?: string; manual_code_enabled?: boolean; sms_sent?: boolean }>("/auth/otp/request/", { method: "POST", body: JSON.stringify({ phone_number }), authenticated: false }),
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
  uploadImage: uploadCaseImage,
  classifyImage: (id: string) => api<import("../types").XRayImage>(`/images/${id}/classify/`, { method: "POST", body: JSON.stringify({}) }),
  confirmImage: (id: string, side: import("../types").KneeSide, view: import("../types").KneeView, reason: string) => api<import("../types").XRayImage>(`/images/${id}/confirm/`, { method: "POST", body: JSON.stringify({ side, view, reason }) }),
  deleteImage: (id: string) => api<void>(`/images/${id}/`, { method: "DELETE" }),
  requestAiAssessment: (id: string) => api<import("../types").Assessment>(`/cases/${id}/ai-assessment/`, { method: "POST", body: JSON.stringify({}) }),
  submit: (id: string) => api<import("../types").MedicalCase>(`/cases/${id}/submit/`, { method: "POST", body: JSON.stringify({}) }),
  saveDoctorAssessment: (id: string, data: Record<string, unknown>) => api(`/cases/${id}/doctor-assessment/`, { method: "PUT", body: JSON.stringify(data) }),
  saveInsuranceDecision: (id: string, data: Record<string, unknown>) => api(`/cases/${id}/insurance-decision/`, { method: "PUT", body: JSON.stringify(data) }),
};
