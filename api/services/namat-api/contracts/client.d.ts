/** Namat API 0.2.0 — local and authenticated staging synthetic intake. Types only; no HTTP implementation. */

export type ApiVersion = 'v1';
export type QuestionnaireVersion = 'namat-hackathon-welcome-v1';
export type QuestionnaireRevision = 'uae-arrival-2026-09-30';

/** Caller-created UUIDv4. Retain for retries; separate from the response trace. */
export type SubmissionIdempotencyKey = string;
/** Server-created UUIDv4 carried in X-Request-Id and error.requestId. */
export type TraceId = string;
/** Saved reference; not a credential for reading a record. */
export type ReceiptId = string;

export type GoalsOption = "checkup" | "prevention" | "symptoms" | "performance" | "uae_move" | "curiosity";
export type AgeOption = "18-30" | "31-40" | "41-50" | "51-60" | "61-70" | "71-plus";
export type SexOption = "female" | "male";
export type LocationOption = "abu-dhabi" | "dubai" | "sharjah" | "ajman" | "umm-al-quwain" | "ras-al-khaimah" | "fujairah";
export type MotivationOption = "prevention" | "history" | "symptoms" | "lifestyle" | "performance" | "weight" | "hormones" | "checkup";
export type PriorityOption = "prevention" | "history" | "symptoms" | "lifestyle" | "performance" | "weight" | "hormones" | "checkup";
export type PreventionOption = "heart" | "metabolism" | "hormones" | "brain" | "cancer" | "reproductive" | "inherited" | "broad" | "other";
export type CheckupOption = "risks" | "measurements" | "guidance" | "priorities" | "plan" | "reassurance";
export type SymptomsOption = "energy" | "weight" | "focus-mood" | "sleep" | "recovery" | "skin-hair" | "digestion" | "movement" | "other" | "none";
export type HistoryOption = "cholesterol" | "blood-pressure" | "blood-sugar" | "hormones" | "reproductive" | "autoimmune" | "stress-anxiety" | "injury" | "other" | "none";
export type PerformanceOption = "energy" | "clarity" | "strength" | "sleep" | "recovery" | "mood" | "injury" | "other";
export type WeightOption = "stable" | "gained" | "lost";
export type HormonesOption = "cycle" | "menopause" | "energy-mood" | "libido" | "body" | "skin-hair" | "check" | "other";
export type CuriosityOption = "metabolism" | "reproductive" | "heart" | "energy" | "clarity" | "risks" | "other" | "unsure";
export type SleepOption = "unrested" | "snore" | "none";
export type FamilyOption = "heart" | "stroke" | "metabolic" | "cancer" | "bone-joint" | "hormonal" | "neurological" | "autoimmune" | "inherited" | "reproductive" | "early" | "none";
export type BloodworkOption = "yes" | "no";

/** Runtime enforces the active path, conditional required fields and option dependencies. */
export interface QuestionnaireAnswers {
  goals: GoalsOption[];
  age: AgeOption;
  sex: SexOption;
  location: LocationOption;
  motivation?: MotivationOption[] | '';
  priority?: PriorityOption | '' | [];
  prevention?: PreventionOption[] | '';
  checkup?: CheckupOption[] | '';
  symptoms?: SymptomsOption[] | '';
  history?: HistoryOption[] | '';
  performance?: PerformanceOption[] | '';
  weight?: WeightOption | '' | [];
  hormones?: HormonesOption[] | '';
  curiosity?: CuriosityOption[] | '';
  sleep?: SleepOption[] | '';
  family: FamilyOption[];
  bloodwork: BloodworkOption;
}

/** At most 200 characters; allowed only for an active “other” response. */
export interface QuestionnaireNotes {
  prevention?: string;
  symptoms?: string;
  history?: string;
  performance?: string;
  hormones?: string;
  curiosity?: string;
}

export interface Report {
  /** Trimmed, matching file extension; <=160 characters and <=256 UTF-8 bytes. */
  name: string;
  type: 'application/pdf' | 'image/jpeg' | 'image/png';
  /** Decoded size; combined report bytes must be <=2 MiB. */
  size: number;
  /** Canonical base64 without a data URL prefix. */
  base64: string;
}

export interface SubmissionRequest {
  version: QuestionnaireVersion;
  questionnaireRevision: QuestionnaireRevision;
  requestId: SubmissionIdempotencyKey;
  dataClass: 'synthetic';
  fictionalConfirmed: true;
  answers: QuestionnaireAnswers;
  notes?: QuestionnaireNotes;
  email: string;
  /** Required and nonblank; at most 80 characters after trimming. */
  firstName: string;
  /** Bloodwork yes: 1–3 reports. Bloodwork no: empty. */
  reports: Report[];
}

/** Stored notification outcome. Accepted is provider acceptance, never delivery. */
export type ConfirmationEmailStatus = 'pending' | 'simulated' | 'accepted' | 'failed' | 'unknown';

export interface SubmissionSaved {
  status: 'saved';
  receiptId: ReceiptId;
  /** New: pending. Replay: stored outcome. Neither API mode sends email. */
  confirmationEmail: ConfirmationEmailStatus;
}

export type ErrorCode = 'validation_failed' | 'invalid_json' | 'forbidden_origin' | 'unauthorized'
  | 'unsupported_media_type' | 'payload_too_large' | 'idempotency_conflict'
  | 'service_unavailable' | 'not_found' | 'method_not_allowed' | 'rate_limited';

export interface ApiError<Code extends ErrorCode = ErrorCode> {
  status: 'error';
  code: Code;
  message: string;
  /** Server trace; does not contain the request body's idempotency key. */
  requestId: TraceId;
}

export interface ApiResponseHeaders {
  'x-request-id': TraceId;
  'cache-control': 'private, no-store';
  'access-control-allow-origin'?: string;
  'access-control-expose-headers'?: string;
  vary?: string;
  allow?: string;
  'retry-after'?: string;
  /** Present when a protected staging operation returns 401. */
  'www-authenticate'?: 'Bearer realm="namat-staging"';
}

/** An adapter may use this shape after reading the HTTP status, headers and JSON. */
export interface HttpResult<Status extends number, Body> {
  status: Status;
  headers: ApiResponseHeaders;
  body: Body;
}

export type SubmissionResponse =
  | HttpResult<201, SubmissionSaved>
  | HttpResult<400, ApiError<'validation_failed' | 'invalid_json'>>
  | HttpResult<401, ApiError<'unauthorized'>>
  | HttpResult<403, ApiError<'forbidden_origin'>>
  | HttpResult<405, ApiError<'method_not_allowed'>>
  | HttpResult<409, ApiError<'idempotency_conflict'>>
  | HttpResult<413, ApiError<'payload_too_large'>>
  | HttpResult<415, ApiError<'unsupported_media_type'>>
  | HttpResult<429, ApiError<'rate_limited'>>
  | HttpResult<503, ApiError<'service_unavailable'>>;

export type OperationBoundaryError =
  | HttpResult<403, ApiError<'forbidden_origin'>>
  | HttpResult<405, ApiError<'method_not_allowed'>>;

/** Protected operations can also reject a missing or invalid staging credential. */
export type ProtectedOperationBoundaryError =
  | OperationBoundaryError
  | HttpResult<401, ApiError<'unauthorized'>>;

export type LivenessResponse = HttpResult<200, {status: 'ok'}> | OperationBoundaryError;
export type ReadinessResponse =
  | HttpResult<200, {status: 'ready'}>
  | HttpResult<503, {status: 'unavailable'}>
  | ProtectedOperationBoundaryError;

/** HEAD responses never carry JSON, including error responses. */
export type HeadProbeResponse = HttpResult<200 | 403 | 405, null>;
export type HeadProtectedProbeResponse = HttpResult<200 | 401 | 403 | 405, null>;
export type HeadReadinessResponse = HttpResult<200 | 401 | 403 | 405 | 503, null>;

export type SubmissionPreflightResponse =
  | HttpResult<204, null>
  | HttpResult<403, ApiError<'forbidden_origin'>>
  | HttpResult<405, ApiError<'method_not_allowed'>>;

export interface ApiOperations {
  'GET /healthz': {response: LivenessResponse};
  'HEAD /healthz': {response: HeadProbeResponse};
  'GET /readyz': {response: ReadinessResponse};
  'HEAD /readyz': {response: HeadReadinessResponse};
  'GET /v1/openapi.json': {response: HttpResult<200, Record<string, unknown>> | ProtectedOperationBoundaryError};
  'HEAD /v1/openapi.json': {response: HeadProtectedProbeResponse};
  'POST /v1/submissions': {request: SubmissionRequest; response: SubmissionResponse};
  'OPTIONS /v1/submissions': {response: SubmissionPreflightResponse};
}
