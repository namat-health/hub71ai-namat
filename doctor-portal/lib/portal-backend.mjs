import { buildCaseContext } from "./clinical/case-context.mjs";
import {
  confirmObservation,
  correctObservation,
  currentObservations,
  labReport,
  mergeReportLabs,
  reviewedList,
} from "./lab-values.mjs";
import { validatePlan } from "./plan.mjs";
import { generatePlan } from "./plan-generator.mjs";
import {
  portalIdentity,
  portalJson,
  requirePortalSession,
} from "./portal-access.mjs";
import {
  listSubmissions,
  reportExtraction,
  reportSourceResponse,
  validStoredReportReference,
  validSubmissionId,
} from "./report-files.mjs";
import {
  sharedApiEnabled,
  sharedReadiness,
  sharedReportExtraction,
  sharedReportSource,
  sharedSaveReview,
  sharedSubmissions,
} from "./shared-api.mjs";

// Keep the Microsoft guard before either backend. getPool is deliberately lazy:
// shared API mode never acquires a database pool, including on upstream failure.
export async function submissionsResponse(request, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    const data = sharedApiEnabled(env)
      ? await sharedSubmissions({ ...options, env })
      : {
          submissions: await listSubmissions(options.getPool(), {
            now: options.now,
          }),
        };
    return portalJson(data);
  } catch {
    return portalJson(
      { error: "Could not load patient submissions. Please try again." },
      503,
    );
  }
}

export async function sourceResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    params = await params;
    if (sharedApiEnabled(env))
      return await sharedReportSource(request, params, { ...options, env });
    return await reportSourceResponse(request, params, {
      ...options,
      env,
      pool: options.getPool(),
    });
  } catch (error) {
    if (error?.code === "not_found")
      return portalJson(
        { error: "This report is unavailable or has expired." },
        404,
      );
    return portalJson(
      { error: "The report could not be opened. Please try again." },
      502,
    );
  }
}

async function readSubmissions(options) {
  return sharedApiEnabled(options.env)
    ? (await sharedSubmissions(options)).submissions
    : await listSubmissions(options.getPool(), { now: options.now });
}

async function readExtraction(reference, options) {
  if (!validStoredReportReference(reference.submissionId, reference.reportId))
    return null;
  return sharedApiEnabled(options.env)
    ? await sharedReportExtraction(reference, options)
    : await reportExtraction(options.getPool(), reference, {
        now: options.now,
      });
}

// What Namat read from one attached report, as lab values with page bounds.
export async function extractionResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  const unavailable = () =>
    portalJson({ error: "These lab values are unavailable." }, 404);
  try {
    const { submissionId, reportId } = await params;
    const data = await readExtraction(
      { submissionId, reportId },
      { ...options, env },
    );
    return data ? portalJson(labReport(data)) : unavailable();
  } catch (error) {
    if (error?.code === "not_found") return unavailable();
    return portalJson(
      { error: "The lab values could not be loaded. Please try again." },
      502,
    );
  }
}

// Builds the generator input on the server from the active submission, so the
// browser never supplies clinical data. The generator gets no name or email.
export async function planResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  const failed = (status) =>
    portalJson(
      { error: "The plan could not be created. Please try again." },
      status,
    );
  try {
    const { submissionId } = await params;
    const submission =
      validSubmissionId(submissionId) &&
      (await readSubmissions({ ...options, env })).find(
        (row) => row.id === submissionId,
      );
    if (!submission)
      return portalJson({ error: "This patient record is unavailable." }, 404);
    const groups = [];
    const reportData = [];
    for (const report of submission.attached_reports) {
      if (!report.sourceUrl) continue;
      // A report with no parser draft adds no values; any other failure stops.
      const data = await readExtraction(
        { submissionId, reportId: report.id },
        { ...options, env },
      ).catch((error) => {
        if (error?.code === "not_found") return null;
        throw error;
      });
      if (data) reportData.push(data);
      if (data?.extraction) groups.push(labReport(data).extraction.labs);
    }
    const labs = mergeReportLabs(groups);
    // No plan is built on a flagged value nobody has checked.
    if (labs.some((lab) => lab.note))
      return portalJson(
        {
          error: "Confirm the flagged lab values first.",
          code: "values_to_confirm",
        },
        409,
      );
    const caseContext = buildCaseContext(submission, reportData, {
      now: options.now,
    });
    if (caseContext.blockers.length)
      return portalJson(
        {
          error: "Finish reading and checking the reports first.",
          code: "case_not_ready",
        },
        409,
      );
    const generate = options.generatePlan || generatePlan;
    const result = await generate({
      caseContext,
      questionnaire: {
        version: submission.questionnaire_version,
        answers: submission.answers,
        notes: submission.notes,
      },
      labs: labs.map(({ bbox, reportId, observationIndex, ...lab }) => lab),
    });
    const plan = validatePlan(result?.plan);
    if (!plan) return failed(502);
    return portalJson({
      plan,
      source: typeof result.source === "string" ? result.source : "generator",
    });
  } catch (error) {
    if (error?.code === "analysis_not_connected")
      return portalJson(
        {
          error:
            "The report and questionnaire are ready. Personalised analysis will be connected next.",
          code: error.code,
        },
        501,
      );
    return failed(503);
  }
}

const MAX_CONFIRMATION_BYTES = 4096;

// "Looks right" or "Fix" on one value. The server re-reads the current values,
// refuses a stale view, and saves the full list as the report's next review
// with the signed-in doctor as its author.
export async function confirmationResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  const stale = () =>
    portalJson(
      {
        error:
          "This report changed since you opened it. Reload to see the latest values.",
        code: "stale",
      },
      409,
    );
  const invalid = () =>
    portalJson({ error: "Check the value and try again." }, 400);
  try {
    const { submissionId, reportId } = await params;
    if (!validStoredReportReference(submissionId, reportId))
      return portalJson({ error: "These lab values are unavailable." }, 404);
    if (!sharedApiEnabled(env))
      return portalJson(
        { error: "Confirming values needs the shared Namat API." },
        503,
      );
    const length = request.headers.get("content-length");
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") || "",
      ) ||
      (length !== null &&
        (!/^\d+$/.test(length) || Number(length) > MAX_CONFIRMATION_BYTES))
    )
      return invalid();
    const text = await request.text();
    if (text.length > MAX_CONFIRMATION_BYTES) return invalid();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return invalid();
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.extractionId !== "string" ||
      !Number.isInteger(body.revision) ||
      body.revision < 0 ||
      !Number.isInteger(body.index) ||
      body.index < 0 ||
      !["confirm", "correct"].includes(body.action)
    )
      return invalid();
    const reference = { submissionId, reportId };
    const data = await sharedReportExtraction(reference, { ...options, env });
    if (
      !data.extraction ||
      data.extraction.id !== body.extractionId ||
      data.reviewRevision !== body.revision
    )
      return stale();
    const current = currentObservations(data);
    const observation = current.observations[body.index];
    if (!observation) return stale();
    const replacement =
      body.action === "confirm"
        ? confirmObservation(observation)
        : correctObservation(observation, body);
    if (!replacement) return invalid();
    const { objectId, name } = portalIdentity(request);
    await sharedSaveReview(
      reference,
      {
        extractionId: body.extractionId,
        expectedReviewRevision: body.revision,
        observations: reviewedList(current, body.index, replacement),
        actor: `${name || "Doctor"} (microsoft:${objectId})`,
      },
      { ...options, env },
    );
    return portalJson(
      labReport(await sharedReportExtraction(reference, { ...options, env })),
    );
  } catch (error) {
    if (error?.code === "conflict") return stale();
    if (error?.code === "invalid") return invalid();
    if (error?.code === "not_found")
      return portalJson({ error: "These lab values are unavailable." }, 404);
    return portalJson(
      { error: "The value couldn’t be saved. Please try again." },
      502,
    );
  }
}

export async function healthResponse(request, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    if (sharedApiEnabled(env)) await sharedReadiness({ ...options, env });
    else await options.getPool().query("SELECT 1");
    return portalJson({ ok: true, database: "connected" });
  } catch {
    return portalJson(
      { ok: false, error: "The workspace data service is unavailable." },
      503,
    );
  }
}

// Read-only preparation endpoint; uses exactly the same authentication and expiry checks as the report routes.
export async function analysisContextResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    const { submissionId } = await params;
    const submission =
      validSubmissionId(submissionId) &&
      (await readSubmissions({ ...options, env })).find(
        (row) => row.id === submissionId,
      );
    if (!submission)
      return portalJson({ error: "This patient record is unavailable." }, 404);
    const reports = [];
    for (const report of submission.attached_reports || []) {
      if (!report.sourceUrl) continue;
      const data = await readExtraction(
        { submissionId, reportId: report.id },
        { ...options, env },
      ).catch((error) => {
        if (error?.code === "not_found") return null;
        throw error;
      });
      if (data) reports.push(data);
    }
    return portalJson({
      caseContext: buildCaseContext(submission, reports, { now: options.now }),
    });
  } catch {
    return portalJson(
      { error: "The case could not be prepared. Please try again." },
      503,
    );
  }
}
