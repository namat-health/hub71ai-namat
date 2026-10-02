import { createHash, randomUUID } from "node:crypto";
import { assembleInterpretation } from "./interpretation-assembly.mjs";

export { assembleInterpretation } from "./interpretation-assembly.mjs";

import { extendCaseKnowledge } from "./case-context.mjs";
import {
  DEMO_VERSION,
  demoInput,
  expandDemoOutput,
} from "./demo-interpretation.mjs";
import { INTERPRETER_SCHEMA_VERSION } from "./interpreter-contract.mjs";
import {
  isRevisionFeedback,
  validateNarrativeCheck,
} from "./narrative-check.mjs";
import {
  createOpenAIProvider,
  encodeModelInput,
  modelConfig,
  PROMPT_VERSION,
  reservationMicros,
  usageMicros,
  verificationInput,
  verificationReservationMicros,
} from "./openai-provider.mjs";
import { PROPOSAL_POLICY_VERSION } from "./proposal-policy.mjs";
import { evaluateCase, RULES_VERSION } from "./rules.mjs";

export class AnalysisError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const digest = (data) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function applyInventoryReviews(context, reviews) {
  const {
    caseFingerprint: _fingerprint,
    assembledAt,
    readyForInterpretation,
    ...evidence
  } = context;
  evidence.reports = context.reports.map((report) => {
    const attestation = reviews.find(
      (item) =>
        item.reportId === report.id &&
        item.extractionId === report.extractionId &&
        item.reviewRevision === report.reviewRevision,
    );
    return attestation
      ? {
          ...report,
          inventoryReview: attestation,
          coverageStatus: "complete",
          coverage: {
            ...report.coverage,
            status: "complete",
            complete: true,
            reason: "clinician_inventory_confirmed",
          },
        }
      : report;
  });
  evidence.reportCoverageComplete =
    evidence.reports.length > 0 &&
    evidence.reports.every((report) => report.coverageStatus === "complete");
  evidence.limitations = (context.limitations || []).filter(
    (item) =>
      item.code !== "parser_inventory_unverified" ||
      !evidence.reports.some(
        (report) => report.id === item.reference && report.inventoryReview,
      ),
  );
  return {
    ...evidence,
    caseFingerprint: digest(evidence),
    assembledAt,
    readyForInterpretation,
  };
}

export function prepareInterpretation(
  baseContext,
  { now = Date.now(), model = "gpt-6.1-sol", mode = "full" } = {},
) {
  if (!baseContext?.readyForInterpretation)
    throw new AnalysisError("case_not_ready");
  const evaluation = evaluateCase(baseContext, { now });
  if (baseContext.observations.length > 500 || baseContext.reports.length > 3)
    throw new AnalysisError("analysis_too_large");
  evaluation.nextRecomputeAt ||= new Date(
    now + 24 * 60 * 60 * 1000,
  ).toISOString();
  // The complete bounded catalogue avoids rule-based retrieval hiding a useful
  // connection. Larger KBs can later use model-directed retrieval + recall evals.
  const needed = baseContext.knowledge.catalogue.map((item) => item.id);
  let context = baseContext;
  for (let i = 0; i < needed.length; i += 20)
    context = extendCaseKnowledge(context, needed.slice(i, i + 20));
  const versions = {
    schema: INTERPRETER_SCHEMA_VERSION,
    proposalPolicy: PROPOSAL_POLICY_VERSION,
    prompt: PROMPT_VERSION,
    rules: RULES_VERSION,
    knowledge: context.knowledge.version,
    knowledgeHash: context.knowledge.sourceSha256,
    model,
    ...(mode === "demo" ? { mode, demo: DEMO_VERSION } : {}),
  };
  // Rule output includes time-derived dispositions. Time alone is excluded;
  // an expiry and changed rule result both prevent reusing stale recommendations.
  const {
    evaluatedAt: _evaluatedAt,
    nextRecomputeAt: _nextRecomputeAt,
    ...ruleState
  } = evaluation;
  const cacheKey = digest({
    fingerprint: context.caseFingerprint,
    versions,
    ruleState,
  });
  return {
    context,
    evaluation,
    versions,
    cacheKey,
    evidenceFingerprint: baseContext.caseFingerprint,
  };
}

export async function interpretCase(
  { caseContext, submissionId, inputSnapshot, expiresAt, loadReportInputs },
  { store, provider, env = process.env, now = Date.now() } = {},
) {
  const config = provider?.config || modelConfig(env);
  const prepared = prepareInterpretation(caseContext, {
    now,
    model: config.model,
    mode: config.mode,
  });
  if (!store) throw new AnalysisError("analysis_storage_unavailable");
  const cached = await store.findRun({
    submissionId,
    cacheKey: prepared.cacheKey,
    now: new Date(now).toISOString(),
  });
  if (cached) {
    const current = await store.getRun({ submissionId, runId: cached.id });
    if (!current) throw new AnalysisError("stale_analysis");
    return {
      ...current.analysis,
      runId: current.id,
      source: "openai",
      cached: true,
      latestDecision: current.latestDecision || null,
    };
  }
  const synthesis = provider || createOpenAIProvider(env);
  if (config.mode !== "demo" && typeof synthesis.verify !== "function")
    throw new AnalysisError("analysis_configuration");
  const reportInputs =
    typeof loadReportInputs === "function" ? await loadReportInputs() : [];
  if (
    caseContext.reports.length !== reportInputs.length ||
    caseContext.reports.some(
      (report) =>
        !reportInputs.some((original) => original.reportId === report.id),
    )
  )
    throw new AnalysisError("case_not_ready");
  const demo =
    config.mode === "demo"
      ? demoInput(prepared.context, prepared.evaluation, reportInputs)
      : null;
  const input =
    demo?.input ||
    encodeModelInput(prepared.context, prepared.evaluation, reportInputs);
  if (reportInputs.length && typeof synthesis.estimate !== "function")
    throw new AnalysisError("analysis_configuration");
  const attempts = [];
  const call = async (body, checking) => {
    const reservationId = randomUUID();
    await store.reserve({
      reservationId,
      amountMicros: synthesis.estimate
        ? await synthesis.estimate(body, reportInputs, checking)
        : checking
          ? verificationReservationMicros(body, config)
          : reservationMicros(body, config),
    });
    // Unknown outcomes keep their reservation. Never retry an ambiguous request.
    const response = await (checking
      ? synthesis.verify(body, reportInputs)
      : synthesis.synthesize(body, reportInputs));
    const costMicros = usageMicros(response.usage, config);
    if (costMicros !== null)
      await store.settle({ reservationId, actualMicros: costMicros });
    return { response, reservationId, costMicros };
  };
  let result,
    cost,
    reservationId,
    verification,
    checkCost,
    checkReservationId,
    analysis;
  let generationInput = input;
  if (demo) {
    const generation = await call(input, false);
    ({ response: result, costMicros: cost, reservationId } = generation);
    if (result.status !== "completed" || !result.output)
      throw new AnalysisError("analysis_incomplete");
    analysis = assembleInterpretation(
      expandDemoOutput(result.output, prepared, demo.ids),
      prepared,
      reportInputs,
    );
    analysis.demo = true;
    analysis.timings = { interpretationMs: result.durationMs ?? null };
    attempts.push({
      generation: {
        model: result.model,
        responseId: result.responseId,
        usage: result.usage || null,
        reservationId,
        costMicros: cost,
        durationMs: result.durationMs,
        serviceTier: result.serviceTier,
      },
      verification: { status: "not_run_demo" },
    });
  } else {
    // At most one correction of well-formed semantic feedback; all four possible
    // calls are separately counted/reserved. Invalid structure/refusals stop.
    for (let attempt = 0; attempt < 2; attempt++) {
      const generation = await call(generationInput, false);
      ({ response: result, costMicros: cost, reservationId } = generation);
      if (result.status !== "completed" || !result.output)
        throw new AnalysisError("analysis_incomplete");
      analysis = assembleInterpretation(result.output, prepared, reportInputs);
      const checked = await call(
        verificationInput(input, result.output, analysis.actionLedger),
        true,
      );
      ({
        response: verification,
        costMicros: checkCost,
        reservationId: checkReservationId,
      } = checked);
      const stageMetadata = ({ response, reservationId, costMicros }) => ({
        model: response.model,
        responseId: response.responseId,
        usage: response.usage || null,
        outputHash: digest(response.output),
        reservationId,
        costMicros,
      });
      attempts.push({
        generation: stageMetadata(generation),
        verification: {
          ...stageMetadata(checked),
          result: verification.output,
        },
      });
      if (
        verification.status === "completed" &&
        validateNarrativeCheck(verification.output)
      )
        break;
      if (
        attempt === 1 ||
        verification.status !== "completed" ||
        !isRevisionFeedback(verification.output)
      )
        throw new AnalysisError("invalid_analysis");
      generationInput = JSON.stringify({
        ...JSON.parse(input),
        revision: {
          previousDraft: result.output,
          issues: verification.output.issues,
        },
      });
    }
  }
  analysis.validation = {
    referenceChecks: "passed",
    narrativeCheck: demo ? "not_run_demo" : "passed",
    clinicalValidation: "not_established",
  };
  const id = randomUUID();
  const expiry = Math.min(
    Date.parse(expiresAt),
    Date.parse(analysis.nextRecomputeAt),
    now + 24 * 60 * 60 * 1000,
  );
  if (!Number.isFinite(expiry) || expiry <= now)
    throw new AnalysisError("case_not_ready");
  const saved = await store.saveRun({
    id,
    submissionId,
    inputSnapshot,
    cacheKey: prepared.cacheKey,
    caseFingerprint: analysis.caseFingerprint,
    evaluatedAt: analysis.evaluatedAt,
    expiresAt: new Date(expiry).toISOString(),
    analysis,
    metadata: {
      ...prepared.versions,
      attempts,
      actualModel: result.model,
      responseId: result.responseId,
      usage: result.usage || null,
      originals: reportInputs.map(({ reportId, mime, sha256, pageCount }) => ({
        reportId,
        mime,
        sha256,
        pageCount,
      })),
      reservationId,
      costMicros: cost,
      verification: demo
        ? { status: "not_run_demo" }
        : {
            actualModel: verification.model,
            responseId: verification.responseId,
            usage: verification.usage || null,
            reservationId: checkReservationId,
            costMicros: checkCost,
            result: verification.output,
          },
    },
  });
  return {
    ...analysis,
    runId: saved?.id || id,
    source: "openai",
    cached: false,
    latestDecision: null,
  };
}
