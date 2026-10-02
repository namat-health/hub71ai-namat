import { closestBloodDraws, testBiomarker } from "./blood-draw.mjs";
import { buildCaseContext } from "./clinical/case-context.mjs";
import {
  applyInventoryReviews,
  prepareInterpretation,
} from "./clinical/interpreter.mjs";
import { modelConfig } from "./clinical/openai-provider.mjs";
import { loadReportInputs } from "./clinical/report-inputs.mjs";
import {
  confirmObservation,
  correctObservation,
  currentObservations,
  labReport,
  mergeReportLabs,
  reviewedList,
} from "./lab-values.mjs";
import {
  MAX_MESSAGE,
  patientEmailReadiness,
  renderPatientEmail,
  sendPatientEmail,
} from "./patient-email.mjs";
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
  sharedAnalysisStore,
  sharedApiEnabled,
  sharedReadiness,
  sharedReportEvidence,
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

async function loadAnalysisCase(submissionId, options) {
  if (!sharedApiEnabled(options.env))
    throw Object.assign(new Error("Shared storage required."), {
      code: "analysis_storage_unavailable",
    });
  const submission =
    validSubmissionId(submissionId) &&
    (await readSubmissions(options)).find((row) => row.id === submissionId);
  if (!submission)
    throw Object.assign(new Error("Missing case."), { code: "not_found" });
  const reports = [];
  for (const report of submission.attached_reports) {
    if (!report.sourceUrl) continue;
    const data = await sharedReportEvidence(
      { submissionId, reportId: report.id },
      options,
    ).catch((error) => {
      if (error?.code === "not_found") return null;
      throw error;
    });
    if (data) reports.push(data);
  }
  const store = options.analysisStore || sharedAnalysisStore(options);
  const inventory = await store.getInventoryReviews({ submissionId });
  const caseContext = applyInventoryReviews(
    buildCaseContext(submission, reports, { now: options.now }),
    inventory,
  );
  return {
    submission,
    reports,
    caseContext,
    loadReportInputs: () =>
      loadReportInputs(
        {
          submissionId,
          attachedReports: submission.attached_reports,
          reports,
        },
        options,
      ),
    inputSnapshot: {
      questionnaireVersion: submission.questionnaire_version,
      answers: submission.answers,
      notes: submission.notes,
      reports: reports.map((item) => ({
        reportId: item.report.id,
        extractionId: item.extraction?.id,
        reviewRevision: item.reviewRevision,
      })),
    },
  };
}

function analysisFailure(error) {
  const failures = {
    not_found: [404, "This patient record is unavailable."],
    case_not_ready: [409, "Finish reading and checking the reports first."],
    values_to_confirm: [409, "Confirm the flagged lab values first."],
    conflict: [
      409,
      "This case changed. Create a fresh analysis before reviewing it.",
    ],
    stale_analysis: [
      409,
      "This case changed. Create a fresh analysis before reviewing it.",
    ],
    budget_exhausted: [
      402,
      "The analysis budget has been reached. Review the saved cases or update the account configuration.",
    ],
    analysis_not_connected: [
      503,
      "The analysis engine is ready. Connect the funded OpenAI account to generate a draft.",
    ],
    analysis_storage_unavailable: [
      503,
      "Connect the shared analysis storage before generating a draft.",
    ],
    invalid_analysis: [
      502,
      "The draft did not pass the evidence checks. No recommendation was saved.",
    ],
    analysis_incomplete: [
      502,
      "The model did not finish a valid draft. No recommendation was saved.",
    ],
    analysis_timeout: [
      504,
      "The AI took too long to respond. No assessment was saved. Please try again.",
    ],
    analysis_too_large: [
      422,
      "This case exceeds the analysis limit. Review the source reports directly.",
    ],
  };
  const [status, message] = failures[error?.code] || [
    503,
    "The analysis could not be completed. Please try again.",
  ];
  return portalJson(
    {
      error: message,
      code: failures[error?.code] ? error.code : "analysis_unavailable",
    },
    status,
  );
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
  try {
    const { submissionId } = await params;
    const {
      submission,
      caseContext,
      inputSnapshot,
      reports,
      loadReportInputs,
    } = await loadAnalysisCase(submissionId, { ...options, env });
    if (
      caseContext.blockers.some(
        (item) => item.code === "value_needs_confirmation",
      )
    )
      throw Object.assign(new Error(), { code: "values_to_confirm" });
    if (!caseContext.readyForInterpretation)
      throw Object.assign(new Error(), { code: "case_not_ready" });
    const result = await (options.generatePlan || generatePlan)(
      {
        caseContext,
        submissionId,
        inputSnapshot,
        loadReportInputs,
        expiresAt: submission.expires_at,
        questionnaire: {
          version: submission.questionnaire_version,
          answers: submission.answers,
          notes: submission.notes,
        },
        labs: mergeReportLabs(
          reports.map((item) => labReport(item).extraction?.labs || []),
        ).map(({ bbox, reportId, observationIndex, ...lab }) => lab),
      },
      {
        store:
          options.analysisStore || sharedAnalysisStore({ ...options, env }),
        provider: options.provider,
        env,
        now: options.now,
      },
    );
    const plan = validatePlan(result?.plan);
    if (!plan) throw Object.assign(new Error(), { code: "invalid_analysis" });
    return portalJson({ ...result, plan });
  } catch (error) {
    return analysisFailure(error);
  }
}

// Reloading the page retrieves a valid saved draft without making an API call.
export async function savedPlanResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    const { submissionId } = await params;
    const { caseContext } = await loadAnalysisCase(submissionId, {
      ...options,
      env,
    });
    const prepared = prepareInterpretation(caseContext, {
      now: options.now,
      model: modelConfig(env).model,
      mode: modelConfig(env).mode,
    });
    const store =
      options.analysisStore || sharedAnalysisStore({ ...options, env });
    const found = await store.findRun({
      submissionId,
      cacheKey: prepared.cacheKey,
    });
    if (!found) return portalJson({ analysis: null });
    const run = await store.getRun({ submissionId, runId: found.id });
    if (!run) return portalJson({ analysis: null });
    return portalJson({
      analysis: {
        ...run.analysis,
        runId: run.id,
        source: "openai",
        cached: true,
        latestDecision: run.latestDecision || null,
      },
    });
  } catch (error) {
    return analysisFailure(error);
  }
}

export async function decisionResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    const { submissionId } = await params;
    if (
      !/^application\/json(?:;.*)?$/i.test(
        request.headers.get("content-type") || "",
      )
    )
      return portalJson({ error: "Invalid review." }, 400);
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > 8192))
      return portalJson({ error: "Invalid review." }, 400);
    const reader = request.body?.getReader();
    if (!reader) return portalJson({ error: "Invalid review." }, 400);
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 8192) {
          await reader.cancel();
          return portalJson({ error: "Invalid review." }, 400);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return portalJson({ error: "Invalid review." }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !validSubmissionId(body.runId) ||
      typeof body.caseFingerprint !== "string" ||
      !Array.isArray(body.selectedTestIds) ||
      body.selectedTestIds.length > 16 ||
      body.selectedTestIds.some(
        (id) => typeof id !== "string" || id.length > 64,
      ) ||
      new Set(body.selectedTestIds).size !== body.selectedTestIds.length ||
      !["approved", "rejected", "needs_changes"].includes(body.decision) ||
      typeof body.notes !== "string" ||
      body.notes.length > 2000
    )
      return portalJson({ error: "Invalid review." }, 400);
    const { caseContext } = await loadAnalysisCase(submissionId, {
      ...options,
      env,
    });
    const prepared = prepareInterpretation(caseContext, {
      now: options.now,
      model: modelConfig(env).model,
      mode: modelConfig(env).mode,
    });
    const store =
      options.analysisStore || sharedAnalysisStore({ ...options, env });
    const run = await store.getRun({ submissionId, runId: body.runId });
    if (
      !run ||
      run.cacheKey !== prepared.cacheKey ||
      body.caseFingerprint !== prepared.context.caseFingerprint ||
      run.caseFingerprint !== prepared.context.caseFingerprint
    )
      throw Object.assign(new Error(), { code: "stale_analysis" });
    if (body.decision === "approved" && prepared.evaluation.blockers.length)
      return portalJson(
        {
          error:
            "Resolve the clinical review alerts before approving this draft.",
          code: "review_required",
        },
        409,
      );
    if (
      body.selectedTestIds.some(
        (id) => !run.analysis.plan.tests.some((test) => test.id === id),
      ) ||
      (body.decision !== "approved" && body.selectedTestIds.length)
    )
      return portalJson({ error: "Invalid test selection." }, 400);
    const { objectId, name } = portalIdentity(request);
    const decision = await store.saveDecision({
      submissionId,
      runId: body.runId,
      caseFingerprint: prepared.context.caseFingerprint,
      actor: `${name || "Doctor"} (microsoft:${objectId})`,
      selectedTestIds: body.selectedTestIds,
      decision: body.decision,
      notes: body.notes,
    });
    return portalJson({ decision });
  } catch (error) {
    return analysisFailure(error);
  }
}

async function readJsonBody(request, limit) {
  if (
    !/^application\/json(?:;.*)?$/i.test(
      request.headers.get("content-type") || "",
    )
  )
    return null;
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// After an approved review, the doctor previews and sends the patient's results email
// (lib/patient-email.mjs). It is rebuilt here from the saved run and its latest decision;
// the browser supplies only the run, an optional message and whether to send.
export async function patientEmailResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    const { submissionId } = await params;
    const body = await readJsonBody(request, 8192);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !validSubmissionId(body.runId) ||
      typeof body.send !== "boolean" ||
      (body.message !== undefined &&
        (typeof body.message !== "string" || body.message.length > MAX_MESSAGE))
    )
      return portalJson({ error: "Invalid email request." }, 400);
    const { submission, reports, caseContext } = await loadAnalysisCase(
      submissionId,
      { ...options, env },
    );
    const prepared = prepareInterpretation(caseContext, {
      now: options.now,
      model: modelConfig(env).model,
      mode: modelConfig(env).mode,
    });
    const store =
      options.analysisStore || sharedAnalysisStore({ ...options, env });
    const run = await store.getRun({ submissionId, runId: body.runId });
    if (
      !run ||
      run.cacheKey !== prepared.cacheKey ||
      run.caseFingerprint !== prepared.context.caseFingerprint
    )
      throw Object.assign(new Error(), { code: "stale_analysis" });
    const decision = run.latestDecision;
    if (decision?.decision !== "approved")
      return portalJson(
        {
          error: "Save an approved review before emailing the patient.",
          code: "not_approved",
        },
        409,
      );
    const plan = run.analysis.plan;
    const tests = plan.tests.filter((test) =>
      decision.selectedTestIds.includes(test.id),
    );
    const labs = mergeReportLabs(
      reports.map((item) => labReport(item).extraction?.labs || []),
    );
    const email = renderPatientEmail({
      firstName: submission.first_name || undefined,
      doctorName:
        decision.actor?.replace(/\s*\(microsoft:[^)]*\)\s*$/, "") || undefined,
      reviewedAt: decision.createdAt,
      message: body.message,
      summary: plan.summaryLong || plan.summaryShort,
      findings: plan.findings.map(({ title, reasonShort }) => ({
        title,
        reason: reasonShort,
      })),
      labs: labs.map(({ name, display, unit, refText, flag }) => ({
        name,
        display,
        unit,
        refText,
        flag,
      })),
      tests: tests.map(({ name, reason }) => ({ name, reason })),
      draws: closestBloodDraws({
        location: submission.answers?.location,
        biomarkers: tests.map((test) =>
          testBiomarker(test, run.analysis.grounding),
        ),
        dir: options.catalogueDir,
      }),
      reference: decision.id,
    });
    const envelope = {
      to: submission.email,
      subject: email.subject,
      mode: patientEmailReadiness({ env }).mode,
    };
    if (!body.send)
      return portalJson({ ...envelope, html: email.html, text: email.text });
    const delivery = await sendPatientEmail(
      { recipientEmail: submission.email, email, reference: decision.id },
      { env, fetcher: options.fetcher },
    );
    return portalJson({ ...envelope, delivery });
  } catch (error) {
    return analysisFailure(error);
  }
}

const MAX_CONFIRMATION_BYTES = 4096;

export async function inventoryResponse(request, params, options = {}) {
  const env = options.env || process.env;
  const denied = requirePortalSession(request, { env });
  if (denied) return denied;
  try {
    const { submissionId } = await params;
    if (!validSubmissionId(submissionId))
      return portalJson({ error: "Invalid case." }, 404);
    const store =
      options.analysisStore || sharedAnalysisStore({ ...options, env });
    if (request.method === "GET")
      return portalJson({
        reviews: await store.getInventoryReviews({ submissionId }),
      });
    if (
      request.method !== "POST" ||
      !/^application\/json(?:;.*)?$/i.test(
        request.headers.get("content-type") || "",
      )
    )
      return portalJson({ error: "Invalid inventory confirmation." }, 400);
    const reader = request.body?.getReader();
    if (!reader)
      return portalJson({ error: "Invalid inventory confirmation." }, 400);
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_CONFIRMATION_BYTES) {
          await reader.cancel();
          return portalJson({ error: "Invalid inventory confirmation." }, 400);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return portalJson({ error: "Invalid inventory confirmation." }, 400);
    }
    if (
      !body ||
      body.confirmed !== true ||
      !validSubmissionId(body.reportId) ||
      !validSubmissionId(body.extractionId) ||
      !Number.isInteger(body.reviewRevision) ||
      body.reviewRevision < 0
    )
      return portalJson({ error: "Invalid inventory confirmation." }, 400);
    const { objectId, name } = portalIdentity(request);
    const review = await store.saveInventoryReview({
      submissionId,
      reportId: body.reportId,
      extractionId: body.extractionId,
      reviewRevision: body.reviewRevision,
      actor: `${name || "Doctor"} (microsoft:${objectId})`,
    });
    return portalJson({ review });
  } catch (error) {
    return analysisFailure(error);
  }
}

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
