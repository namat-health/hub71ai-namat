// Server routes only. Microsoft identity stays at the portal boundary; this
// private service key is never forwarded to the browser or arbitrary URLs.
import {
  fileResponse,
  validMetadata,
  validReportReference,
  verifyBytes,
} from "./report-files.mjs";

export const SHARED_API_ORIGIN =
  "https://namat-api-staging-uaen-001.azurewebsites.net";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const MAX_LIST_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTION_BYTES = 4 * 1024 * 1024;
const QUESTIONNAIRE_VERSIONS = new Set([
  "namat-hackathon-welcome-v1",
  "namat-hackathon-welcome-v2",
]);
const FIELDS = [
  "id",
  "receipt_id",
  "questionnaire_version",
  "data_class",
  "fictional_confirmed",
  "answers",
  "notes",
  "email",
  "first_name",
  "created_at",
  "expires_at",
  "attached_reports",
];
const REPORT_FIELDS = ["id", "name", "mime", "size", "status", "sourceUrl"];
const STATUS = new Set([
  "uploading",
  "rejected",
  "queued",
  "processing",
  "ready",
  "failed",
]);
const MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const AVAILABLE = new Set(["queued", "processing", "ready", "failed"]);
const plain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  plain(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export class SharedApiError extends Error {
  constructor(code = "unavailable") {
    super("The Namat API could not complete this request.");
    this.name = "SharedApiError";
    this.code = code;
  }
}

export function sharedApiEnabled(env = process.env) {
  return env.NAMAT_SHARED_API_ENABLED === "true";
}

function settings(env) {
  if (
    !sharedApiEnabled(env) ||
    env.NAMAT_SHARED_API_ORIGIN !== SHARED_API_ORIGIN ||
    typeof env.NAMAT_SHARED_API_PORTAL_TOKEN !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(env.NAMAT_SHARED_API_PORTAL_TOKEN)
  ) {
    throw new SharedApiError("configuration");
  }
  return env.NAMAT_SHARED_API_PORTAL_TOKEN;
}

async function readBounded(response, maxBytes, expectedSize) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) ||
      Number(declared) > maxBytes ||
      (expectedSize !== undefined && Number(declared) !== expectedSize))
  )
    throw new SharedApiError();
  const reader = response.body?.getReader();
  if (!reader) throw new SharedApiError();
  const chunks = [];
  let total = 0,
    complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (
        total > maxBytes ||
        (expectedSize !== undefined && total > expectedSize)
      )
        throw new SharedApiError();
      chunks.push(Buffer.from(value));
    }
    if (expectedSize !== undefined && total !== expectedSize)
      throw new SharedApiError();
    return Buffer.concat(chunks, total);
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const FAILURES = new Map([
  [400, "invalid"],
  [404, "not_found"],
  [409, "conflict"],
]);

async function request(
  path,
  consume,
  { env = process.env, fetchImpl = fetch, timeoutMs = 25000 } = {},
  { method = "GET", body } = {},
) {
  const token = settings(env);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30000 ||
    typeof fetchImpl !== "function"
  )
    throw new SharedApiError("configuration");
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SharedApiError("timeout"));
    }, timeoutMs);
  });
  const perform = async () => {
    const url = SHARED_API_ORIGIN + path;
    const response = await fetchImpl(url, {
      method,
      headers: {
        "X-Namat-Service-Key": token,
        "Accept-Encoding": "identity",
        Accept: "application/json, application/pdf, image/png, image/jpeg",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (
      response.redirected ||
      (response.url && response.url !== url) ||
      (response.status >= 300 && response.status < 400)
    )
      throw new SharedApiError();
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      throw new SharedApiError(FAILURES.get(response.status) || "unavailable");
    }
    return consume(response);
  };
  try {
    return await Promise.race([perform(), deadline]);
  } catch (error) {
    throw error instanceof SharedApiError ? error : new SharedApiError();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function json(response, maxBytes) {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(
      response.headers.get("content-type") || "",
    )
  )
    throw new SharedApiError();
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readBounded(response, maxBytes),
    ),
  );
}

function listShape(data, now) {
  if (
    !exact(data, ["submissions"]) ||
    !Array.isArray(data.submissions) ||
    data.submissions.length > 1000
  )
    throw new SharedApiError();
  const ids = new Set();
  for (const row of data.submissions) {
    if (
      !exact(row, FIELDS) ||
      typeof row.id !== "string" ||
      !UUID.test(row.id) ||
      ids.has(row.id) ||
      typeof row.receipt_id !== "string" ||
      !UUID.test(row.receipt_id) ||
      !QUESTIONNAIRE_VERSIONS.has(row.questionnaire_version) ||
      row.data_class !== "synthetic" ||
      row.fictional_confirmed !== true ||
      !plain(row.answers) ||
      !plain(row.notes) ||
      typeof row.email !== "string" ||
      row.email.length > 254 ||
      (row.first_name !== null &&
        (typeof row.first_name !== "string" || row.first_name.length > 80)) ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      typeof row.expires_at !== "string" ||
      !(Date.parse(row.expires_at) > now) ||
      !Array.isArray(row.attached_reports) ||
      row.attached_reports.length > 6
    )
      throw new SharedApiError();
    ids.add(row.id);
    const reportIds = new Set();
    for (const report of row.attached_reports) {
      const localPath = `/api/submissions/${encodeURIComponent(row.id)}/reports/${encodeURIComponent(report?.id)}/source`;
      if (
        !exact(report, REPORT_FIELDS) ||
        !validReportReference(row.id, report.id) ||
        reportIds.has(report.id) ||
        typeof report.name !== "string" ||
        report.name.length > 160 ||
        !MIME.has(report.mime) ||
        !Number.isInteger(report.size) ||
        report.size < 1 ||
        report.size > MAX_REPORT_BYTES ||
        !STATUS.has(report.status) ||
        (report.sourceUrl !== null &&
          (report.sourceUrl !== localPath || !AVAILABLE.has(report.status)))
      ) {
        throw new SharedApiError();
      }
      reportIds.add(report.id);
    }
  }
  return data;
}

export async function sharedSubmissions(options = {}) {
  return request(
    "/v1/demo/submissions",
    async (response) =>
      listShape(
        await json(response, MAX_LIST_BYTES),
        options.now ?? Date.now(),
      ),
    options,
  );
}

export async function sharedReadiness(options = {}) {
  return request(
    "/v1/demo/ready",
    async (response) => {
      const data = await json(response, 4096);
      if (!exact(data, ["status"]) || data.status !== "ready")
        throw new SharedApiError();
      return true;
    },
    options,
  );
}

const OBSERVATION_FIELDS = [
  "name",
  "value",
  "unit",
  "referenceRange",
  "date",
  "sourceText",
  "page",
  "bounds",
];
const OBSERVATION_TEXT = OBSERVATION_FIELDS.slice(0, 6);
const UNITS = new Set(["pt", "inch", "pixel"]);
const pageNumber = (value) =>
  Number.isInteger(value) && value >= 1 && value <= 50;
const validBounds = (bounds) =>
  bounds === null ||
  (Array.isArray(bounds)
    ? bounds.length === 8 && bounds.every(Number.isFinite)
    : exact(bounds, ["x", "y", "width", "height"]) &&
      Object.values(bounds).every(Number.isFinite));

const DECISIONS = new Set(["approved", "corrected", "needs_changes"]);
const REVIEW_FIELDS = [...OBSERVATION_TEXT, "page", "confirmed"];

function reviewShape(review) {
  return (
    exact(review, ["revision", "decision", "createdAt", "observations"]) &&
    Number.isInteger(review.revision) &&
    review.revision >= 1 &&
    DECISIONS.has(review.decision) &&
    typeof review.createdAt === "string" &&
    Number.isFinite(Date.parse(review.createdAt)) &&
    Array.isArray(review.observations) &&
    review.observations.length <= 500 &&
    review.observations.every(
      (observation) =>
        exact(observation, REVIEW_FIELDS) &&
        pageNumber(observation.page) &&
        typeof observation.confirmed === "boolean" &&
        OBSERVATION_TEXT.every(
          (field) =>
            observation[field] === null ||
            (typeof observation[field] === "string" &&
              observation[field].length <= 5000),
        ),
    )
  );
}

function extractionShape(data, reportId) {
  if (
    !exact(data, ["report", "extraction", "review", "reviewRevision"]) ||
    !Number.isInteger(data.reviewRevision) ||
    data.reviewRevision < 0 ||
    (data.review !== null &&
      (data.extraction === null ||
        !reviewShape(data.review) ||
        data.review.revision > data.reviewRevision)) ||
    !exact(data.report, ["id", "status", "pageCount"]) ||
    data.report.id !== reportId ||
    !AVAILABLE.has(data.report.status) ||
    (data.report.pageCount !== null && !pageNumber(data.report.pageCount))
  )
    throw new SharedApiError();
  const draft = data.extraction;
  if (draft === null) return data;
  if (
    !exact(draft, [
      "id",
      "processorVersion",
      "createdAt",
      "pages",
      "observations",
      "warnings",
    ]) ||
    typeof draft.id !== "string" ||
    !UUID.test(draft.id) ||
    typeof draft.processorVersion !== "string" ||
    !draft.processorVersion ||
    draft.processorVersion.length > 160 ||
    typeof draft.createdAt !== "string" ||
    !Number.isFinite(Date.parse(draft.createdAt)) ||
    !Array.isArray(draft.pages) ||
    draft.pages.length > 50 ||
    draft.pages.some(
      (page) =>
        !exact(page, ["number", "unit"]) ||
        !pageNumber(page.number) ||
        !UNITS.has(page.unit),
    ) ||
    !Array.isArray(draft.observations) ||
    draft.observations.length > 500 ||
    draft.observations.some(
      (observation) =>
        !exact(observation, OBSERVATION_FIELDS) ||
        !pageNumber(observation.page) ||
        !validBounds(observation.bounds) ||
        OBSERVATION_TEXT.some(
          (field) =>
            observation[field] !== null &&
            (typeof observation[field] !== "string" ||
              observation[field].length > 5000),
        ),
    ) ||
    !Array.isArray(draft.warnings) ||
    draft.warnings.length > 20 ||
    draft.warnings.some(
      (warning) => typeof warning !== "string" || warning.length > 500,
    )
  )
    throw new SharedApiError();
  return data;
}

// Latest parser draft for one stored report. Legacy attachments have none.
export async function sharedReportExtraction(
  { submissionId, reportId },
  options = {},
) {
  if (!validReportReference(submissionId, reportId) || !UUID.test(reportId))
    throw new SharedApiError("not_found");
  return request(
    `/v1/demo/submissions/${encodeURIComponent(submissionId)}/reports/${encodeURIComponent(reportId)}/extraction`,
    async (response) =>
      extractionShape(await json(response, MAX_EXTRACTION_BYTES), reportId),
    options,
  );
}

// Saves a doctor's checked or corrected values as the report's next review.
export async function sharedSaveReview(
  { submissionId, reportId },
  payload,
  options = {},
) {
  if (!validReportReference(submissionId, reportId) || !UUID.test(reportId))
    throw new SharedApiError("not_found");
  return request(
    `/v1/demo/submissions/${encodeURIComponent(submissionId)}/reports/${encodeURIComponent(reportId)}/reviews`,
    async (response) => {
      const data = await json(response, 64 * 1024);
      if (
        !exact(data, ["review"]) ||
        !exact(data.review, ["revision", "createdAt"]) ||
        !Number.isInteger(data.review.revision) ||
        data.review.revision < 1 ||
        typeof data.review.createdAt !== "string"
      )
        throw new SharedApiError();
      return data;
    },
    options,
    { method: "POST", body: payload },
  );
}

function reportName(response) {
  const disposition = response.headers.get("content-disposition") || "";
  if (disposition.length > 2048) throw new SharedApiError();
  const encoded = disposition.match(/(?:^|;)\s*filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      throw new SharedApiError();
    }
  }
  return (
    disposition.match(/(?:^|;)\s*filename="([^"\r\n]*)"/i)?.[1] || "report"
  );
}

export async function sharedReportSource(
  requestObject,
  { submissionId, reportId },
  options = {},
) {
  if (!validReportReference(submissionId, reportId))
    throw new SharedApiError("not_found");
  return request(
    `/v1/demo/submissions/${encodeURIComponent(submissionId)}/reports/${encodeURIComponent(reportId)}`,
    async (response) => {
      const size = response.headers.get("content-length");
      const report = {
        name: reportName(response),
        mime: response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase(),
        size: size && /^\d+$/.test(size) ? Number(size) : null,
        sha256: response.headers.get("x-namat-content-sha256"),
      };
      if (!validMetadata(report)) throw new SharedApiError();
      const bytes = await readBounded(response, MAX_REPORT_BYTES, report.size);
      if (!verifyBytes(bytes, report)) throw new SharedApiError();
      return fileResponse(requestObject, bytes, report);
    },
    options,
  );
}
