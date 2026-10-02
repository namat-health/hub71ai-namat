import { randomUUID } from "node:crypto";
// Deterministic provider DOUBLE for transport/evidence tests. Never connected to
// production generation; these sentences are not model or clinician evaluations.
import {
  MAX_OUTPUT_TOKENS,
  MODEL_PRICES,
} from "../../lib/clinical/openai-provider.mjs";
export const config = {
  model: "gpt-6.1-sol",
  price: MODEL_PRICES["gpt-6.1-sol"],
  maxOutputTokens: MAX_OUTPUT_TOKENS,
};
export function offlineResponse(prepared) {
  // Hand-authored transport fixture: deliberately independent of any rule
  // pattern/candidate menu. It is not an expected clinical interpretation.
  const context = prepared.context;
  const knowledge = context.selectedKnowledge || context.knowledge;
  const observations = context.observations || [];
  const known = observations.filter((row) =>
    knowledge.claims.some((claim) =>
      claim.id.startsWith(`marker:${row.markerId}:`),
    ),
  );
  const findings = [];
  for (let i = 0; i < known.length; i += 12) {
    const rows = known.slice(i, i + 12);
    findings.push({
      id: `fixture-finding-${findings.length + 1}`,
      title: "Recorded laboratory findings for review",
      kind: "observation",
      priority: "review",
      evidenceIds: rows.map((row) => row.id),
      contraryEvidenceIds: [],
      claimIds: [
        ...new Set(
          rows
            .map(
              (row) =>
                knowledge.claims.find((claim) =>
                  claim.id.startsWith(`marker:${row.markerId}:`),
                )?.id,
            )
            .filter(Boolean),
        ),
      ],
      reasonShort:
        "Review the recorded results and the printed laboratory ranges.",
      reasonLong:
        "The findings need clinical context; this fictional transport fixture makes no diagnosis.",
      uncertainties: [
        "This is a hand-authored software test fixture, not an AI or clinician interpretation.",
      ],
    });
  }
  const fatigue = context.questionnaire.facts.find(
    (fact) =>
      fact.key === "symptoms" &&
      fact.kind === "answer" &&
      fact.status === "reported" &&
      fact.value?.includes("energy"),
  );
  const ferritinClaim = knowledge.claims.find(
    (claim) => claim.id === "marker:ferritin:evidence_note",
  );
  const actionLedger =
    fatigue && ferritinClaim
      ? [
          {
            knowledgeId: "marker:ferritin",
            intent: observations.some((row) => row.markerId === "ferritin")
              ? "repeat"
              : "new",
            decision: "propose",
            findingIds: findings.slice(0, 1).map((finding) => finding.id),
            evidenceIds: [fatigue.id],
            claimIds: [ferritinClaim.id],
            reason:
              "Consider iron assessment only after reviewing prior results and resolving any remaining context.",
          },
        ]
      : [];
  return {
    caseFingerprint: context.caseFingerprint,
    summaryShort:
      "Findings require review alongside the reported symptoms and history.",
    summaryLong:
      "This fictional test output checks the evidence workflow. The interpretation remains a draft for a clinician.",
    reportEvidence: [],
    findings,
    actionLedger,
    questions: [],
    observationCoverage: observations.map((row) => {
      const findingIds = findings
        .filter((finding) => finding.evidenceIds.includes(row.id))
        .map((finding) => finding.id);
      return {
        observationId: row.id,
        disposition: findingIds.length ? "addressed" : "uncertain",
        findingIds,
        reason: findingIds.length
          ? "Included in the source-result review."
          : "Unmapped source result needs clinician review.",
      };
    }),
    reportCoverage: (context.reports || []).flatMap((report) =>
      (report.pages || []).map((page) => ({
        reportId: report.id,
        page: page.number,
        status: page.text?.trim() ? "reviewed" : "unreadable",
        reason: page.text?.trim()
          ? "Fictional source page included in the transport fixture."
          : "Source text is unreadable in this transport fixture.",
      })),
    ),
  };
}
export function memoryStore() {
  const runs = [],
    reservations = new Map(),
    decisions = [];
  return {
    runs,
    reservations,
    decisions,
    async findRun({ submissionId, cacheKey, now = new Date().toISOString() }) {
      return (
        runs.find(
          (run) =>
            run.submissionId === submissionId &&
            run.cacheKey === cacheKey &&
            Date.parse(run.expiresAt) > Date.parse(now),
        ) || null
      );
    },
    async getRun({ submissionId, runId }) {
      const run = runs.find(
        (item) => item.submissionId === submissionId && item.id === runId,
      );
      return run ? { ...run, latestDecision: decisions.at(-1) || null } : null;
    },
    async reserve(input) {
      reservations.set(input.reservationId, { ...input });
    },
    async settle(input) {
      Object.assign(reservations.get(input.reservationId), input);
    },
    async saveRun(input) {
      runs.push(structuredClone(input));
      return input;
    },
    async saveDecision(input) {
      // The engine assigns each decision a UUID (services/clinical-analysis/store.mjs).
      const value = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      decisions.push(value);
      return value;
    },
  };
}
