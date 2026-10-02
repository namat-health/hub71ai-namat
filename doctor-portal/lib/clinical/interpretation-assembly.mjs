import { validatePlan } from "../plan.mjs";
import { matchesSchema } from "./interpreter-contract.mjs";
import { assertNarrativeBoundaries } from "./narrative-check.mjs";
import { evaluateModelProposal } from "./proposal-policy.mjs";

const invalid = () => {
  throw Object.assign(
    new Error("The analysis could not be grounded in this case."),
    { code: "invalid_analysis" },
  );
};
const unique = (xs) => new Set(xs).size === xs.length;
const normalized = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim();
const safeNarrative = (s) =>
  !/https?:\/\/|\bwww\.|(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?/u.test(s);

export function assembleInterpretation(raw, prepared, reportInputs = []) {
  const { context, evaluation } = prepared;
  if (!matchesSchema(raw) || raw.caseFingerprint !== context.caseFingerprint)
    invalid();
  assertNarrativeBoundaries(raw, context);
  const facts = new Map(
    [...context.questionnaire.facts, ...context.observations].map((x) => [
      x.id,
      x,
    ]),
  );
  const claims = new Map(context.knowledge.claims.map((x) => [x.id, x]));
  const records = new Map([
    ...context.knowledge.markers.map((x) => [`marker:${x.id}`, x]),
    ...context.knowledge.screening.map((x) => [`screening:${x.id}`, x]),
  ]);
  const reportPages = new Map();
  for (const report of context.reports) {
    const original = reportInputs.find((r) => r.reportId === report.id);
    const count = original?.pageCount ?? report.pages.length;
    for (let page = 1; page <= count; page++) {
      const extracted = report.pages.find((p) => p.number === page);
      reportPages.set(`${report.id}:${page}`, {
        id: `report:${report.id}:page:${page}`,
        reportId: report.id,
        page,
        text: extracted?.text || "",
        hasOriginal: Boolean(original),
      });
    }
  }
  if (!unique(raw.reportEvidence.map((x) => x.id))) invalid();
  const reportEvidence = raw.reportEvidence.map((quote) => {
    const page = reportPages.get(`${quote.reportId}:${quote.page}`);
    if (
      !/^citation:[a-z0-9][a-z0-9-]{0,63}$/.test(quote.id) ||
      facts.has(quote.id) ||
      !page
    )
      invalid();
    const matches = normalized(page.text).includes(normalized(quote.quote));
    // A literal match is checkable. Mixed scanned/text PDFs may have only a
    // header in the text layer; unmatched visual readings stay unconfirmed.
    if (!matches && !page.hasOriginal) invalid();
    const checked = {
      ...quote,
      verification: matches ? "text_match" : "visual_unconfirmed",
    };
    facts.set(quote.id, checked);
    return checked;
  });
  const findingMap = new Map(raw.findings.map((x) => [x.id, x]));
  if (
    !unique(raw.findings.map((x) => x.id)) ||
    !unique(raw.actionLedger.map((x) => x.knowledgeId))
  )
    invalid();
  const refs = (ids, map) => unique(ids) && ids.every((id) => map.has(id));
  const narrative = [
    raw.summaryShort,
    raw.summaryLong,
    ...raw.findings.flatMap((x) => [
      x.title,
      x.reasonShort,
      x.reasonLong,
      ...x.uncertainties,
    ]),
    ...raw.actionLedger.map((x) => x.reason),
    ...raw.questions.map((x) => x.text),
    ...raw.observationCoverage.map((x) => x.reason),
    ...raw.reportCoverage.map((x) => x.reason),
  ];
  if (narrative.some((s) => !safeNarrative(s))) invalid();
  for (const f of raw.findings) {
    if (
      !/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(f.id) ||
      !f.evidenceIds.length ||
      !refs(f.evidenceIds, facts) ||
      !refs(f.contraryEvidenceIds, facts) ||
      !refs(f.claimIds, claims) ||
      f.evidenceIds.some((id) => f.contraryEvidenceIds.includes(id)) ||
      (f.kind === "possible_explanation" && !f.claimIds.length)
    )
      invalid();
  }
  const required = new Set(
    evaluation.patterns
      .filter((p) => p.requiredReview)
      .flatMap((p) => p.observationIds || []),
  );
  if (
    [...required].some(
      (id) =>
        !raw.findings.some(
          (f) =>
            f.evidenceIds.includes(id) || f.contraryEvidenceIds.includes(id),
        ),
    )
  )
    invalid();
  const observations = new Map(context.observations.map((x) => [x.id, x]));
  if (
    raw.observationCoverage.length !== observations.size ||
    !unique(raw.observationCoverage.map((x) => x.observationId))
  )
    invalid();
  for (const row of raw.observationCoverage) {
    if (
      !observations.has(row.observationId) ||
      !refs(row.findingIds, findingMap)
    )
      invalid();
    if (
      row.disposition === "addressed" &&
      (!row.findingIds.length ||
        row.findingIds.some((id) => {
          const f = findingMap.get(id);
          return ![...f.evidenceIds, ...f.contraryEvidenceIds].includes(
            row.observationId,
          );
        }))
    )
      invalid();
    if (required.has(row.observationId) && row.disposition !== "addressed")
      invalid();
  }
  if (
    raw.reportCoverage.length !== reportPages.size ||
    !unique(raw.reportCoverage.map((x) => `${x.reportId}:${x.page}`))
  )
    invalid();
  for (const row of raw.reportCoverage)
    if (!reportPages.has(`${row.reportId}:${row.page}`)) invalid();
  for (const q of raw.questions)
    if (!q.evidenceIds.length || !refs(q.evidenceIds, facts)) invalid();
  const pageStatus = new Map(
    raw.reportCoverage.map((x) => [`${x.reportId}:${x.page}`, x.status]),
  );
  for (const quote of reportEvidence)
    if (pageStatus.get(`${quote.reportId}:${quote.page}`) !== "reviewed")
      invalid();

  const chip = (id) => {
    const item = facts.get(id);
    if (item.uiLabId) return { type: "lab", labId: item.uiLabId };
    if (item.reportId)
      return {
        type: "report",
        reportId: item.reportId,
        page: item.page,
        label: `Source page ${item.page}`,
      };
    return {
      type: "questionnaire",
      key: item.key,
      label: String(item.key).replaceAll("_", " "),
    };
  };
  const findings = raw.findings.map((f) => {
    const values = f.evidenceIds
      .map((id) => facts.get(id))
      .filter((x) => x.uiLabId)
      .map((x) => {
        const c = x.current || x.asRecorded;
        return `${x.name} ${c.value} ${c.unit || ""}`.trim();
      })
      .join(" · ");
    return {
      title: f.title,
      severity:
        f.priority === "review" || f.evidenceIds.some((id) => required.has(id))
          ? "act"
          : "monitor",
      keyValues: values.length <= 80 ? values : "See source values",
      reasonShort: f.reasonShort,
      reasonLong: f.reasonLong,
      evidence: [...f.evidenceIds, ...f.contraryEvidenceIds]
        .slice(0, 8)
        .map(chip),
    };
  });
  const groundedFindings = raw.findings.map((f, index) => ({
    index,
    id: f.id,
    kind: f.kind,
    evidenceIds: f.evidenceIds,
    contraryEvidenceIds: f.contraryEvidenceIds,
    claimIds: f.claimIds,
    uncertainties: [
      ...new Set([
        ...f.uncertainties,
        ...f.evidenceIds
          .filter((id) => facts.get(id)?.verification === "visual_unconfirmed")
          .map(
            () =>
              "Confirm the visual reading against the original report before acting.",
          ),
      ]),
    ],
  }));
  const tests = [],
    groundedTests = [],
    actionLedger = [];
  const unreadable = raw.reportCoverage.some(
    (row) => row.status === "unreadable",
  );
  for (const action of raw.actionLedger) {
    if (
      !records.has(action.knowledgeId) ||
      !action.evidenceIds.length ||
      !action.claimIds.length ||
      !refs(action.evidenceIds, facts) ||
      !refs(action.claimIds, claims) ||
      !refs(action.findingIds, findingMap) ||
      (action.decision === "propose" && !action.findingIds.length)
    )
      invalid();
    const policy = evaluateModelProposal(
      action,
      { ...context, reportEvidence },
      evaluation,
    );
    // A visually discovered/unclear result in a supporting finding cannot be
    // hidden by citing only a questionnaire answer on the proposed test itself.
    const indirect = action.findingIds.flatMap((id) => [
      ...findingMap.get(id).evidenceIds,
      ...findingMap.get(id).contraryEvidenceIds,
    ]);
    if (
      policy.status === "eligible" &&
      (unreadable ||
        indirect.some(
          (id) => facts.get(id)?.verification === "visual_unconfirmed",
        ))
    ) {
      policy.status = "needs_context";
      policy.reasons.push(
        unreadable
          ? "Clarify unreadable report pages before selecting further tests."
          : "Confirm the supporting visual reading against the report before selecting this test.",
      );
    }
    const decision =
      action.decision === "propose" && policy.status !== "eligible"
        ? policy.status === "already_available"
          ? "already_available"
          : "defer"
        : action.decision;
    const testId = action.knowledgeId.replace(":", "-");
    actionLedger.push({
      id: `proposal:${action.knowledgeId}`,
      knowledgeId: action.knowledgeId,
      testId,
      intent: action.intent,
      decision,
      modelDecision: action.decision,
      rationale: action.reason,
      policyStatus: policy.status,
      policyReasons: policy.reasons,
      evidenceIds: policy.evidenceIds,
      claimIds: action.claimIds,
      findingIds: action.findingIds,
    });
    if (decision !== "propose") continue;
    const record = records.get(action.knowledgeId);
    tests.push({
      id: testId,
      name: record.name.slice(0, 60),
      group: "consider",
      reason: action.reason,
      includes: "",
      prep: "Confirm with laboratory",
      locationType: action.knowledgeId.startsWith("screening:")
        ? "clinic"
        : "lab",
    });
    groundedTests.push({
      testId,
      knowledgeId: action.knowledgeId,
      evidenceIds: policy.evidenceIds,
      claimIds: action.claimIds,
      missingInformation: policy.reasons,
    });
  }
  const usedClaimIds = new Set(
    [...raw.findings, ...raw.actionLedger].flatMap((x) => x.claimIds),
  );
  const usedClaims = [...claims.values()].filter((c) => usedClaimIds.has(c.id));
  const sourceIds = new Set(usedClaims.flatMap((c) => c.sourceIds));
  const plan = validatePlan({
    summaryShort: raw.summaryShort,
    summaryLong: raw.summaryLong,
    findings,
    tests,
    followUps: [],
    sources: sourceIds.size,
  });
  if (!plan) invalid();
  return {
    plan,
    grounding: {
      findings: groundedFindings,
      tests: groundedTests,
      questionsForDoctor: [
        ...new Set([
          ...raw.questions.map((q) => q.text),
          ...evaluation.questions.map((q) => q.text),
        ]),
      ],
    },
    actionLedger,
    coverage: evaluation.coverage.map((row) => ({
      ...row,
      modelDisposition: raw.observationCoverage.find(
        (c) => c.observationId === row.observationId,
      ),
    })),
    reportCoverage: raw.reportCoverage,
    limitations: [
      ...context.limitations,
      ...evaluation.limitations,
      ...(unreadable
        ? [
            {
              code: "unreadable_report_page",
              reason: "Some report pages could not be interpreted.",
            },
          ]
        : []),
    ],
    reviewAlerts: evaluation.blockers,
    evidence: {
      observations: context.observations,
      facts: context.questionnaire.facts,
      reportEvidence,
      reportPages: [...reportPages.values()].map(({ id, reportId, page }) => ({
        id,
        reportId,
        page,
      })),
      claims: usedClaims,
      sources: context.knowledge.sources.filter((s) => sourceIds.has(s.id)),
    },
    clinicalStatus: "draft_ai_interpretation_not_clinically_validated",
    ...Object.fromEntries(
      ["versions", "cacheKey", "evidenceFingerprint"].map((key) => [
        key,
        prepared[key],
      ]),
    ),
    caseFingerprint: context.caseFingerprint,
    evaluatedAt: evaluation.evaluatedAt,
    nextRecomputeAt: evaluation.nextRecomputeAt,
  };
}
