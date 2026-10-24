export type Role = "patient" | "doctor" | "insurance";
export type CaseStatus = "draft" | "submitted" | "under_review" | "completed";
export type Verdict = "surgery" | "no_surgery" | "inconclusive";

export interface User {
  id: string;
  phone_number: string;
  national_code?: string | null;
  birth_date?: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role;
  medical_council_number?: string;
  organization_name?: string;
  is_verified: boolean;
  audit_access?: boolean;
}

export interface DoctorPatientAssignment {
  id: number;
  patient: User;
  created_at: string;
}

export interface Questionnaire {
  age_years: number | null;
  gender: "female" | "male" | "other" | "";
  underlying_conditions: string[];
  medications: string[];
  height_cm: string | null;
  weight_kg: string | null;
  bmi?: number | null;
  pain_level: number;
  pain_duration_months: number;
  mobility_limit: "none" | "mild" | "moderate" | "severe";
  previous_treatments: string[];
  conservative_treatment_rounds: number;
  conservative_duration_months: number;
  conservative_response: "not_tried" | "none" | "partial" | "good";
  had_intra_articular_injection: boolean;
  injection_rounds: number;
  injection_types: string[];
  daily_life_impact: "none" | "mild" | "moderate" | "severe";
  smoking_status: "never" | "former" | "current";
  diabetes_status: "none" | "controlled" | "uncontrolled" | "unknown";
  has_night_pain: boolean;
  uses_walking_aid: boolean;
  additional_notes: string;
}

export interface CatalogOption {
  value: string;
  label: string;
  secondary: string;
}

export interface WOMACResponse {
  version: string;
  scale: string;
  responses: Record<string, number>;
  supplemental_responses: Record<string, number>;
  pain_score: number;
  stiffness_score: number;
  function_score: number;
  total_score: number;
  normalized_score: string;
  health_score: number;
  completed_at: string;
}

export interface XRayImage {
  id: string;
  image_url: string;
  view: string;
  uploaded_at: string;
}

export interface Assessment {
  id: string;
  source: "doctor" | "ai";
  source_label: string;
  author?: User;
  verdict: Verdict;
  verdict_label: string;
  rationale: string;
  clinical_history: string;
  has_lower_back_pain?: boolean | null;
  has_hip_pain?: boolean | null;
  kl_grade?: number | null;
  radiographic_oa_confirmed?: boolean | null;
  risk_optimization?: "not_assessed" | "needed" | "optimized";
  expectation_notes?: string;
  model_name?: string;
  model_version?: string;
  confidence?: string;
  created_at: string;
}

export interface InsuranceDecision {
  id: number;
  reviewer_name: string;
  is_mine: boolean;
  decision: "approved" | "rejected";
  decision_label: string;
  rationale: string;
  created_at: string;
  updated_at: string;
}

export interface MedicalCase {
  id: string;
  title: string;
  patient: User;
  managing_doctor?: User | null;
  status: CaseStatus;
  status_label: string;
  image_count: number;
  has_doctor_assessment: boolean;
  has_ai_assessment: boolean;
  has_insurance_decision: boolean;
  can_edit_intake: boolean;
  submitted_at?: string;
  created_at: string;
  updated_at: string;
  questionnaire?: Questionnaire;
  womac?: WOMACResponse;
  images?: XRayImage[];
  assessments?: Assessment[];
  insurance_decision?: InsuranceDecision | null;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
