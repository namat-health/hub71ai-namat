// Ordering constraints for an AI-originated proposal. This is not a clinical
// indication engine: the semantic verifier and reviewing physician assess why.
// Only trusted case context can record consent or clinical checks; proposal text
// and model-supplied check flags cannot satisfy these gates.
export const PROPOSAL_POLICY_VERSION = "namat-proposal-policy-2026-10-02.1";

const unique = (items) => [...new Set(items)];
const key = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const current = (row) => row.current || row.asRecorded || {};
const reported = (fact) =>
  ["reported", "explicitly_reported"].includes(fact?.status);
const numeric = /^([<>≤≥])?\s*([-+]?\d+(?:\.\d+)?)$/;
const qualitative =
  /^(?:positive|negative|reactive|non[ -]?reactive|detected|not detected)$/i;

function readable(row) {
  const raw = current(row);
  if (
    row.issue ||
    !raw.sourceText?.trim() ||
    !Number.isInteger(row.page) ||
    row.page < 1 ||
    row.parsed?.unitInferred
  )
    return false;
  const value = String(raw.value ?? "").trim();
  const match = value.match(numeric);
  if (!match) return qualitative.test(value);
  return (
    Boolean(String(raw.unit || "").trim()) &&
    (!Number.isFinite(row.parsed?.value) ||
      row.parsed.value === Number(match[2]))
  );
}

// Report dates and ingestion timestamps must never stand in for specimen dates.
function collectionTime(row) {
  const raw = current(row);
  const value =
    raw.collectionDate ||
    (["collection", "collected", "specimen_collection"].includes(raw.dateKind)
      ? raw.date
      : null);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value.slice(0, 10)
    ? time
    : null;
}

function addMonths(time, months) {
  const date = new Date(time),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

function catalogueRecord(knowledge, id) {
  const [kind, localId, extra] = String(id || "").split(":");
  if (extra || !localId) return null;
  const rows = { marker: knowledge.markers, screening: knowledge.screening }[
    kind
  ];
  return rows?.find((row) => row.id === localId) || null;
}

function evidenceIndex(context) {
  return new Map([
    ...(context.questionnaire?.facts || []).map((row) => [
      row.id,
      { kind: "fact", row },
    ]),
    ...(context.observations || []).map((row) => [
      row.id,
      { kind: "observation", row },
    ]),
    ...(context.reportEvidence || []).map((row) => [
      row.id,
      { kind: "citation", row },
    ]),
    ...(context.reports || []).flatMap((report) =>
      (report.pages || []).flatMap((page) => [
        [page.id, { kind: "page", row: page }],
        ...(page.lines || []).map((row) => [row.id, { kind: "page", row }]),
      ]),
    ),
  ]);
}

function inventoryComplete(context) {
  // These fields are assembled server-side from version-bound doctor attestations.
  return (
    context.reportCoverageComplete === true ||
    ((context.reports || []).length > 0 &&
      context.reports.every(
        (report) =>
          report.coverageStatus === "complete" ||
          report.coverage?.complete === true ||
          report.inventoryComplete === true,
      ))
  );
}

function isExcluded(record, knowledgeId, knowledge) {
  if (record.namat_verdict === "not-offered" || record.not_offered === true)
    return true;
  const names = new Set(
    [record.id, record.name, ...(record.aliases || [])].map(key),
  );
  return (knowledge.notOffered || []).some(
    (entry) =>
      entry.knowledgeId === knowledgeId ||
      entry.id === knowledgeId ||
      entry.knowledgeIds?.includes(knowledgeId) ||
      (entry.test && names.has(key(entry.test))),
  );
}

/**
 * Post-hoc eligibility only, not evidence entailment or a clinical sign-off.
 * `evaluation` supplies trusted safety blockers and a reproducible evaluatedAt.
 * Trusted optional context.clinicianChecks[knowledgeId] supports:
 * consentRecorded, sharedDecisionRecorded, contraindicationPresent,
 * contraindicationsReviewed, pregnancyStatus ("yes"/"no"/"unknown").
 * Missing checks stay unknown. No baseline or symptom trigger is required.
 */
export function evaluateModelProposal(proposal, context, evaluation = {}) {
  const knowledgeId =
    typeof proposal?.knowledgeId === "string" ? proposal.knowledgeId : "";
  const knowledge = context.selectedKnowledge || context.knowledge || {};
  const evidence = evidenceIndex(context);
  const supplied = Array.isArray(proposal?.evidenceIds)
    ? proposal.evidenceIds
    : [];
  const evidenceIds = unique(
    supplied.filter((id) => typeof id === "string" && evidence.has(id)),
  );
  const reasons = [];
  const result = (status) => ({
    status,
    reasons: unique(reasons),
    evidenceIds: unique(evidenceIds),
    knowledgeId,
  });
  const record = catalogueRecord(knowledge, knowledgeId);
  const catalogue = knowledge.catalogue || [];
  if (!catalogue.some((row) => row.id === knowledgeId)) {
    reasons.push("The proposed test is not in the supplied Namat catalogue.");
    return result("blocked");
  }
  if (!record) {
    reasons.push(
      "Retrieve the complete catalogue record before checking this proposal.",
    );
    return result("needs_context");
  }
  if (isExcluded(record, knowledgeId, knowledge)) {
    reasons.push(
      "The supplied knowledge base explicitly lists this test as not offered.",
    );
    return result("blocked");
  }
  if (
    !supplied.length ||
    supplied.some((id) => typeof id !== "string" || !evidence.has(id))
  ) {
    reasons.push(
      "Patient evidence is missing or contains an unknown reference.",
    );
    return result("blocked");
  }
  const claims = new Set((knowledge.claims || []).map((claim) => claim.id));
  if (
    !Array.isArray(proposal.claimIds) ||
    !proposal.claimIds.length ||
    proposal.claimIds.some((id) => !claims.has(id))
  ) {
    reasons.push(
      "Knowledge support is missing or contains an unknown claim reference.",
    );
    return result("blocked");
  }
  if (proposal.intent && !["new", "repeat"].includes(proposal.intent)) {
    reasons.push(
      "The proposal intent must identify a new test or a repeat test.",
    );
    return result("blocked");
  }
  const age = context.questionnaire?.exactAge;
  if (Number.isInteger(age) && age < 18) {
    reasons.push("This demonstration's ordering checks cover adults only.");
    return result("blocked");
  }
  const checks = context.clinicianChecks?.[knowledgeId] || {};
  if (checks.contraindicationPresent === true) {
    reasons.push(
      "A clinician has recorded a contraindication to this proposal.",
    );
    return result("blocked");
  }
  const facts = context.questionnaire?.facts || [];
  const fact = (name) =>
    facts.find(
      (item) => item.kind === "answer" && item.key === name && reported(item),
    );
  const yes = (value) =>
    value === "yes" || (Array.isArray(value) && value.includes("yes"));
  if (
    yes(fact("pregnancy")?.value) ||
    yes(fact("treatment")?.value) ||
    checks.pregnancyStatus === "yes"
  ) {
    reasons.push(
      "Reported pregnancy or active serious treatment requires an individual clinician assessment outside these demonstration ordering checks.",
    );
    return result("blocked");
  }
  const safetyBlocks = (evaluation.blockers || []).filter(
    (blocker) => blocker.blocks === "test_proposals",
  );
  if (safetyBlocks.length) {
    reasons.push(
      ...safetyBlocks.map(
        (blocker) =>
          blocker.reason ||
          "A safety finding requires clinician review before test selection.",
      ),
    );
    return result("blocked");
  }
  if (!Number.isInteger(age) || age < 18)
    reasons.push("Confirm exact adult age before selecting tests.");
  for (const id of evidenceIds) {
    const item = evidence.get(id);
    if (item.kind === "observation" && !readable(item.row))
      reasons.push(
        "A supporting lab value has unresolved extraction or source uncertainty.",
      );
    if (item.kind === "fact" && !reported(item.row))
      reasons.push(
        "A cited questionnaire answer is unknown or not recorded; it cannot be assumed negative.",
      );
    if (item.kind === "page")
      reasons.push(
        "Identify and verify the specific source excerpt; a page or line reference alone is not a verified clinical reading.",
      );
    if (
      item.kind === "citation" &&
      (item.row.verification !== "text_match" || !item.row.quote?.trim())
    )
      reasons.push(
        "A report excerpt has an unconfirmed source reading; the clinician must confirm it against the original PDF before selecting tests.",
      );
  }
  if (record.requires_consent === true && checks.consentRecorded !== true)
    reasons.push(
      "Record the required informed consent before selecting this test.",
    );
  if (
    record.shared_decision_required === true &&
    checks.sharedDecisionRecorded !== true
  )
    reasons.push(
      "Record the required shared decision before selecting this test.",
    );
  if (
    record.contraindications?.length &&
    checks.contraindicationsReviewed !== true
  )
    reasons.push(
      "Review the catalogue's contraindications before selecting this test.",
    );
  if (
    record.requires_pregnancy_status === true &&
    !["yes", "no"].includes(checks.pregnancyStatus || fact("pregnancy")?.value)
  )
    reasons.push(
      "Pregnancy status is unknown; confirm it for this test without inferring a negative result.",
    );
  // Screening bands are coarse eligibility hints. They cannot resolve anatomy,
  // exact screening intervals, exceptions, or prose risk requirements.
  if (
    record.who?.sexes?.length === 1 &&
    !record.who.sexes.includes(fact("sex")?.value)
  )
    reasons.push(
      "Confirm the anatomy and screening eligibility relevant to this proposal.",
    );
  if (record.who?.age_bands?.length && Number.isInteger(age)) {
    const band =
      age <= 30
        ? "18-30"
        : age <= 40
          ? "31-40"
          : age <= 50
            ? "41-50"
            : age <= 60
              ? "51-60"
              : age <= 70
                ? "61-70"
                : "71-plus";
    if (!record.who.age_bands.includes(band))
      reasons.push(
        "The patient is outside this record's routine screening age bands; review the individual indication.",
      );
  }
  const existing = knowledgeId.startsWith("marker:")
    ? (context.observations || []).filter((row) => row.markerId === record.id)
    : (context.observations || []).filter(
        (row) => row.knowledgeId === knowledgeId,
      );
  if (existing.length) {
    evidenceIds.push(...existing.map((row) => row.id));
    const dated = existing.map((row) => ({ row, time: collectionTime(row) }));
    const validNow = Date.parse(
      evaluation.evaluatedAt || context.assembledAt || "",
    );
    const now = Number.isFinite(validNow) ? validNow : Date.now();
    const unknownDate = dated.some((item) => item.time === null);
    const newest = dated.filter(
      (item) =>
        item.time === Math.max(...dated.map((item) => item.time ?? -Infinity)),
    );
    const conflicting =
      new Set(
        newest.map(({ row }) =>
          JSON.stringify([
            current(row).value,
            current(row).unit,
            current(row).referenceRange,
          ]),
        ),
      ).size > 1;
    if (
      existing.some((row) => !readable(row)) ||
      conflicting ||
      (existing.length > 1 && unknownDate)
    ) {
      reasons.push(
        "Existing results have unresolved reading, date or duplicate conflicts; resolve them before deciding whether another test is needed.",
      );
      return result("needs_context");
    }
    if (dated.some((item) => item.time !== null && item.time > now)) {
      reasons.push(
        "An existing specimen date is in the future; verify the source date.",
      );
      return result("needs_context");
    }
    if (proposal.intent === "repeat") {
      reasons.push(
        record.never_repeat_to_confirm === true
          ? "The knowledge record says not to repeat solely to confirm this result; review the appropriate clinical next step."
          : "A result already exists; a clinician must establish the reason and timing for repeating it.",
      );
      return result("needs_context");
    }
    if (record.frequency === "once_in_lifetime") {
      reasons.push(
        "A source-backed result for this once-in-lifetime test is already available.",
      );
      return result(reasons.length > 1 ? "needs_context" : "already_available");
    }
    if (unknownDate) {
      reasons.push(
        "An existing result has no verified specimen date; its reuse window cannot be established.",
      );
      return result("needs_context");
    }
    if (
      !Number.isFinite(record.reuse_window_months) ||
      record.reuse_window_months <= 0
    ) {
      reasons.push(
        "An existing result is present, but the knowledge record has no executable reuse interval.",
      );
      return result("needs_context");
    }
    if (addMonths(newest[0].time, record.reuse_window_months) > now) {
      reasons.push(
        "A source-backed result is already available within the knowledge record's reuse window.",
      );
      return result(reasons.length > 1 ? "needs_context" : "already_available");
    }
  } else if (proposal.intent === "repeat") {
    reasons.push(
      "No source-backed prior result establishes what this proposed repeat would repeat.",
    );
  }
  if (!inventoryComplete(context))
    reasons.push(
      "Verify every uploaded report's test inventory and prior-result availability before selecting an additional test.",
    );
  if (reasons.length) return result("needs_context");
  reasons.push(
    "Basic catalogue, context and reuse checks passed. The clinical rationale still requires semantic verification and physician review; these draft checks are not clinical sign-off.",
  );
  return result("eligible");
}
