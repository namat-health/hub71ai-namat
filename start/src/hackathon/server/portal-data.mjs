import { createHash } from "node:crypto";
// These functions are called only after the internal upstream transport key is
// verified by azure-server.mjs. Public HTTP paths never expose this module.
function portalJson(body, status = 200) {
  return Response.json(body, {status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);
const AVAILABLE = new Set(["queued", "processing", "ready", "failed"]);
const SUBMISSION_FIELDS = [
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
];

function sourceUrl(submissionId, reportId) {
  return `/api/submissions/${encodeURIComponent(submissionId)}/reports/${encodeURIComponent(reportId)}/source`;
}

function validMetadata(report) {
  return (
    TYPES.has(report.mime) &&
    Number.isInteger(report.size) &&
    report.size > 0 &&
    report.size <= MAX_BYTES &&
    /^[a-f0-9]{64}$/.test(report.sha256 || "")
  );
}

function attachment(report, submissionId) {
  return {
    id: report.id,
    name:
      typeof report.name === "string"
        ? report.name.slice(0, 160)
        : "Uploaded report",
    mime: report.mime,
    size: report.size,
    status: report.status,
    sourceUrl:
      validMetadata(report) && AVAILABLE.has(report.status)
        ? sourceUrl(submissionId, report.id)
        : null,
  };
}

function syntheticActive(row, now) {
  return (
    row.data_class === "synthetic" &&
    row.fictional_confirmed === true &&
    new Date(row.expires_at).getTime() > now
  );
}

export async function listSubmissions(pool, { now = Date.now() } = {}) {
  const { rows } =
    await pool.query(`SELECT id, receipt_id, questionnaire_version, data_class, fictional_confirmed,
    answers, notes, email, first_name, created_at, expires_at, report_metadata,
    cardinality(report_files) AS legacy_report_count
    FROM public.hackathon_welcome_submissions
    WHERE data_class='synthetic' AND fictional_confirmed=TRUE AND expires_at>now()
    ORDER BY created_at DESC,id DESC`);
  const submissions = rows.filter((row) => syntheticActive(row, now));
  const ids = submissions.map((row) => row.id);
  const { rows: reports } = ids.length
    ? await pool.query(
        `SELECT r.id,r.submission_id,r.name,r.mime,r.size,r.sha256,r.status,r.expires_at
    FROM public.namat_reports r JOIN public.hackathon_welcome_submissions s ON s.id=r.submission_id
    WHERE r.submission_id=ANY($1::uuid[]) AND r.expires_at>now() AND s.expires_at>now()
      AND s.data_class='synthetic' AND s.fictional_confirmed=TRUE
    ORDER BY r.created_at,r.id`,
        [ids],
      )
    : { rows: [] };
  return submissions.map((row) => {
    const current = reports.filter(
      (report) =>
        report.submission_id === row.id &&
        new Date(report.expires_at).getTime() > now,
    );
    const cloudHashes = new Set(current.map((report) => report.sha256));
    const attached = current.map((report) => attachment(report, row.id));
    const legacy = Array.isArray(row.report_metadata)
      ? row.report_metadata
      : [];
    for (
      let index = 0;
      index < Math.min(legacy.length, row.legacy_report_count || 0, 3);
      index += 1
    ) {
      const metadata = legacy[index];
      if (!metadata || cloudHashes.has(metadata.sha256)) continue;
      attached.push(
        attachment(
          {
            ...metadata,
            id: `legacy-${index}`,
            mime: metadata.type,
            status: "ready",
          },
          row.id,
        ),
      );
    }
    return {
      ...Object.fromEntries(
        SUBMISSION_FIELDS.map((field) => [field, row[field]]),
      ),
      attached_reports: attached,
    };
  });
}

function notFound() {
  return portalJson(
    { error: "This report is unavailable or has expired." },
    404,
  );
}
function sourceUnavailable() {
  return portalJson(
    { error: "The report could not be opened. Please try again." },
    502,
  );
}

function verifyBytes(bytes, report) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== report.size ||
    createHash("sha256").update(bytes).digest("hex") !== report.sha256
  )
    return false;
  if (report.mime === "application/pdf")
    return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (report.mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (report.mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return false;
}

function fileResponse(request, bytes, report) {
  const extension = TYPES.get(report.mime);
  let name = String(report.name || `report.${extension}`)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip controls from untrusted filenames before building HTTP headers.
    .replace(/[\x00-\x1f\x7f/\\]/g, "_")
    .slice(0, 160);
  if (
    !new RegExp(
      `\\.(?:${extension === "jpg" ? "jpe?g" : extension})$`,
      "i",
    ).test(name)
  )
    name += `.${extension}`;
  const fallback = name.replace(/[^\x20-\x7e]|[";]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const disposition =
    new URL(request.url).searchParams.get("download") === "1"
      ? "attachment"
      : "inline";
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": report.mime,
      "Content-Length": String(bytes.length),
      "X-Namat-Content-Sha256": report.sha256,
      "Content-Disposition": `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; sandbox; frame-ancestors 'self'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const MAX_EXTRACTION_BYTES = 4 * 1024 * 1024;
const OBSERVATION_TEXT = [
  "name",
  "value",
  "unit",
  "referenceRange",
  "date",
  "sourceText",
];

// Native PDF lines carry {x,y,width,height} in PDF points from the page's
// top-left corner. OCR lines carry an 8-number polygon in the provider's page
// unit: inches for PDFs and pixels for images.
function observationBounds(bounds) {
  if (Array.isArray(bounds))
    return bounds.length === 8 && bounds.every(Number.isFinite)
      ? bounds
      : null;
  if (!bounds || typeof bounds !== "object") return null;
  const box = [bounds.x, bounds.y, bounds.width, bounds.height];
  return box.every(Number.isFinite)
    ? { x: box[0], y: box[1], width: box[2], height: box[3] }
    : null;
}

function draftObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clean = {};
  for (const field of OBSERVATION_TEXT)
    clean[field] =
      typeof value[field] === "string" ? value[field].slice(0, 5000) : null;
  if (!Number.isInteger(value.page) || value.page < 1) return null;
  clean.page = value.page;
  clean.bounds = observationBounds(value.bounds);
  return clean;
}

// Reviews store no bounds. `confirmed` marks a value a doctor explicitly checked.
function reviewedObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clean = {};
  for (const field of OBSERVATION_TEXT)
    clean[field] =
      typeof value[field] === "string" ? value[field].slice(0, 5000) : null;
  if (!Number.isInteger(value.page) || value.page < 1) return null;
  clean.page = value.page;
  clean.confirmed = value.confirmed === true;
  return clean;
}

function pageUnit(page, ocr, mime) {
  if (!ocr) return "pt";
  const unit = (Array.isArray(page?.lines) ? page.lines : []).find(
    (line) => typeof line?.unit === "string",
  )?.unit;
  if (["inch", "pixel"].includes(unit)) return unit;
  return mime === "application/pdf" ? "inch" : "pixel";
}

/**
 * Latest parser draft for one bound report: observations, warnings and each
 * page's coordinate unit, plus the latest review of that draft and the
 * report's current review revision. Page text and older reviews stay here.
 */
export async function reportExtractionResponse(
  { submissionId, reportId },
  { pool, now = Date.now() } = {},
) {
  if (!UUID.test(submissionId || "") || !UUID.test(reportId || ""))
    return notFound();
  try {
    const {
      rows: [row],
    } = await pool.query(
      `SELECT r.id,r.submission_id,r.mime,r.status,r.page_count,r.expires_at,
      s.data_class,s.fictional_confirmed,s.expires_at AS submission_expires_at,
      e.id AS extraction_id,e.processor_version,e.created_at AS extracted_at,e.pages,e.observations,e.warnings,
      v.revision AS reviewed_revision,v.decision AS review_decision,v.observations AS review_observations,v.created_at AS reviewed_at,
      (SELECT COALESCE(MAX(revision),0) FROM public.namat_report_reviews WHERE report_id=r.id)::integer AS review_revision
      FROM public.namat_reports r JOIN public.hackathon_welcome_submissions s ON s.id=r.submission_id
      LEFT JOIN LATERAL (SELECT id,processor_version,created_at,pages,observations,warnings
        FROM public.namat_report_extractions WHERE report_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1) e ON TRUE
      LEFT JOIN LATERAL (SELECT revision,decision,observations,created_at
        FROM public.namat_report_reviews WHERE report_id=r.id AND extraction_id=e.id ORDER BY revision DESC LIMIT 1) v ON TRUE
      WHERE r.id=$1 AND r.submission_id=$2 AND r.expires_at>now() AND s.expires_at>now()
        AND s.data_class='synthetic' AND s.fictional_confirmed=TRUE
        AND r.status IN ('queued','processing','ready','failed')`,
      [reportId, submissionId],
    );
    if (
      !row ||
      row.id !== reportId ||
      row.submission_id !== submissionId ||
      !syntheticActive(row, now) ||
      !(new Date(row.submission_expires_at).getTime() > now) ||
      !AVAILABLE.has(row.status)
    )
      return notFound();
    const ocr = /:azure-layout$/.test(row.processor_version || "");
    const extraction = row.extraction_id
      ? {
          id: row.extraction_id,
          processorVersion: row.processor_version,
          createdAt: new Date(row.extracted_at).toISOString(),
          pages: (Array.isArray(row.pages) ? row.pages : [])
            .filter((page) => Number.isInteger(page?.number))
            .map((page) => ({
              number: page.number,
              unit: pageUnit(page, ocr, row.mime),
            })),
          observations: (Array.isArray(row.observations)
            ? row.observations
            : []
          )
            .slice(0, 500)
            .map(draftObservation)
            .filter(Boolean),
          warnings: (Array.isArray(row.warnings) ? row.warnings : [])
            .filter((warning) => typeof warning === "string")
            .slice(0, 20)
            .map((warning) => warning.slice(0, 500)),
        }
      : null;
    const review =
      extraction && Number.isInteger(row.reviewed_revision)
        ? {
            revision: row.reviewed_revision,
            decision: row.review_decision,
            createdAt: new Date(row.reviewed_at).toISOString(),
            observations: (Array.isArray(row.review_observations)
              ? row.review_observations
              : []
            )
              .slice(0, 500)
              .map(reviewedObservation)
              .filter(Boolean),
          }
        : null;
    const body = JSON.stringify({
      report: {
        id: row.id,
        status: row.status,
        pageCount: Number.isInteger(row.page_count) ? row.page_count : null,
      },
      extraction,
      review,
      reviewRevision: Number.isInteger(row.review_revision)
        ? row.review_revision
        : 0,
    });
    if (Buffer.byteLength(body) > MAX_EXTRACTION_BYTES)
      return portalJson({ status: "unavailable" }, 503);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return portalJson({ status: "unavailable" }, 503);
  }
}

/**
 * A doctor's checked or corrected values for one bound report, saved as the
 * next immutable review revision ("corrected"). The store rejects a stale
 * draft or revision, so two doctors cannot overwrite each other.
 */
export async function reportReviewResponse(
  { submissionId, reportId },
  { pool, store, body, now = Date.now() } = {},
) {
  if (!UUID.test(submissionId || "") || !UUID.test(reportId || ""))
    return notFound();
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 4 ||
    !UUID.test(body.extractionId || "") ||
    !Number.isInteger(body.expectedReviewRevision) ||
    body.expectedReviewRevision < 0 ||
    !Array.isArray(body.observations) ||
    typeof body.actor !== "string" ||
    !body.actor.trim() ||
    body.actor.length > 256 ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: an actor label must be one plain line.
    /[\u0000-\u001f\u007f]/.test(body.actor)
  )
    return portalJson({ status: "error", code: "invalid_review" }, 400);
  try {
    const {
      rows: [row],
    } = await pool.query(
      `SELECT r.id,r.submission_id,r.expires_at,s.data_class,s.fictional_confirmed,s.expires_at AS submission_expires_at
      FROM public.namat_reports r JOIN public.hackathon_welcome_submissions s ON s.id=r.submission_id
      WHERE r.id=$1 AND r.submission_id=$2 AND r.expires_at>now() AND s.expires_at>now()
        AND s.data_class='synthetic' AND s.fictional_confirmed=TRUE`,
      [reportId, submissionId],
    );
    if (
      !row ||
      row.id !== reportId ||
      row.submission_id !== submissionId ||
      !syntheticActive(row, now) ||
      !(new Date(row.submission_expires_at).getTime() > now)
    )
      return notFound();
    const review = await store.saveReview(
      reportId,
      {
        extractionId: body.extractionId,
        observations: body.observations,
        decision: "corrected",
        expectedReviewRevision: body.expectedReviewRevision,
      },
      body.actor.trim(),
    );
    return portalJson({
      review: {
        revision: review.revision,
        createdAt: new Date(review.createdAt).toISOString(),
      },
    });
  } catch (error) {
    if (
      error?.name === "ReportStoreError" &&
      [400, 404, 409].includes(error.status)
    )
      return portalJson({ status: "error", code: error.code }, error.status);
    return portalJson({ status: "unavailable" }, 503);
  }
}

export async function reportSourceResponse(
  request,
  { submissionId, reportId },
  { pool, blobs, now = Date.now() } = {},
) {
  if (
    !UUID.test(submissionId || "") ||
    (!UUID.test(reportId || "") && !/^legacy-[0-2]$/.test(reportId || ""))
  )
    return notFound();
  try {
    if (reportId.startsWith("legacy-")) {
      const index = Number(reportId.slice(7));
      const {
        rows: [row],
      } = await pool.query(
        `SELECT id,data_class,fictional_confirmed,expires_at,
        report_metadata->$2::integer AS metadata,report_files[($2::integer)+1] AS bytes
        FROM public.hackathon_welcome_submissions
        WHERE id=$1 AND data_class='synthetic' AND fictional_confirmed=TRUE AND expires_at>now()`,
        [submissionId, index],
      );
      if (
        !row ||
        row.id !== submissionId ||
        !syntheticActive(row, now) ||
        !row.metadata ||
        !row.bytes
      )
        return notFound();
      const report = { ...row.metadata, mime: row.metadata.type };
      if (!validMetadata(report) || !verifyBytes(row.bytes, report))
        return sourceUnavailable();
      return fileResponse(request, row.bytes, report);
    }
    const {
      rows: [report],
    } = await pool.query(
      `SELECT r.id,r.submission_id,r.name,r.mime,r.size,r.sha256,r.status,r.expires_at,r.blob_key,
      s.data_class,s.fictional_confirmed,s.expires_at AS submission_expires_at
      FROM public.namat_reports r JOIN public.hackathon_welcome_submissions s ON s.id=r.submission_id
      WHERE r.id=$1 AND r.submission_id=$2 AND r.expires_at>now() AND s.expires_at>now()
        AND s.data_class='synthetic' AND s.fictional_confirmed=TRUE
        AND r.status IN ('queued','processing','ready','failed')`,
      [reportId, submissionId],
    );
    if (
      !report ||
      report.id !== reportId ||
      report.submission_id !== submissionId ||
      !syntheticActive(report, now) ||
      !(new Date(report.submission_expires_at).getTime() > now) ||
      !AVAILABLE.has(report.status)
    )
      return notFound();
    if (!validMetadata(report)) return sourceUnavailable();
    if (report.blob_key !== `reports/${report.id}`) return sourceUnavailable();
    const bytes = await blobs.read(report.blob_key);
    if (!verifyBytes(bytes, report)) return sourceUnavailable();
    return fileResponse(request, bytes, report);
  } catch {
    return sourceUnavailable();
  }
}
