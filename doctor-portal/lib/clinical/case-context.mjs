import { createHash } from "node:crypto";
import {
  currentObservations,
  labReport,
  mergeReportLabs,
} from "../lab-values.mjs";
import { answerText, QUESTIONNAIRE_GROUPS } from "../questionnaire.mjs";
import {
  getKnowledgeRecords,
  markerId,
  selectKnowledge,
} from "./knowledge.mjs";
export const CASE_VERSION = "namat-case-v2";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const answered = (value) =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === "string" && value !== "";
const questionKeys = QUESTIONNAIRE_GROUPS.flatMap((group) =>
  group.rows.map((row) => row.key),
).filter((key) => key !== "email");
const knownVersions = new Set([
  "namat-hackathon-welcome-v1",
  "namat-hackathon-welcome-v2",
]);
const unknownAnswer = (value) =>
  (Array.isArray(value) ? value : [value]).some((item) =>
    ["unsure", "declined"].includes(item),
  );
const asString = (value) => (typeof value === "string" ? value : null);

function recordedFields(value) {
  const kind =
    value?.date && ["collection", "report"].includes(value.dateKind)
      ? value.dateKind
      : "unknown";
  return {
    name: asString(value?.name),
    value: asString(value?.value),
    unit: asString(value?.unit),
    referenceRange: asString(value?.referenceRange),
    date: asString(value?.date),
    dateKind: kind,
    collectionDate: kind === "collection" ? value.date : null,
    reportDate: kind === "report" ? value.date : null,
    dateSourceText: asString(value?.dateSourceText),
    dateSourcePage: Number.isInteger(value?.dateSourcePage)
      ? value.dateSourcePage
      : null,
    sourceText: asString(value?.sourceText),
  };
}

function originalFor(current, originals, index, reviewed) {
  if (!reviewed) return { observation: originals[index], index };
  const matches = originals
    .map((observation, index) => ({ observation, index }))
    .filter(
      ({ observation }) =>
        observation.page === current.page &&
        observation.sourceText === current.sourceText,
    );
  return matches.length === 1 ? matches[0] : { observation: null, index: null };
}

function effectiveFields(value, original) {
  // Legacy review rows carry no typed date. An unchanged date can retain its
  // original provenance; an edited date cannot become a collection date by fiat.
  const effective = { ...value };
  if (original && value.date === original.date && !value.dateKind) {
    for (const key of ["dateKind", "dateSourceText", "dateSourcePage"])
      effective[key] = original[key];
  }
  return recordedFields(effective);
}

/** Combines stored evidence only. It makes no clinical interpretation or model call. */
export function buildCaseContext(
  submission,
  reportData,
  { now = Date.now() } = {},
) {
  const facts = [];
  const version = submission.questionnaire_version;
  for (const key of questionKeys) {
    const value = submission.answers?.[key];
    facts.push({
      id: `answer:${key}`,
      kind: "answer",
      key,
      value: answered(value) ? value : null,
      text: answerText(key, submission) || null,
      status: answered(value)
        ? unknownAnswer(value)
          ? "unknown"
          : "reported"
        : "not_recorded",
      origin: "patient_reported",
      questionnaireVersion: version,
    });
    const note = submission.notes?.[key];
    if (typeof note === "string" && note.trim())
      facts.push({
        id: `note:${key}`,
        kind: "note",
        key,
        value: note,
        text: note,
        status: "reported",
        origin: "patient_reported",
        questionnaireVersion: version,
      });
  }
  const reports = [],
    groups = [];
  for (const attached of submission.attached_reports || []) {
    const data = reportData.find((item) => item?.report?.id === attached.id);
    const view = data ? labReport(data) : null;
    const extraction = data?.extraction;
    const current = data ? currentObservations(data) : { observations: [] };
    reports.push({
      id: attached.id,
      status: data?.report?.status || attached.status,
      extractionId: extraction?.id || null,
      reviewRevision: data?.reviewRevision ?? 0,
      reviewDecision: data?.review?.decision || null,
      reviewedAt: data?.review?.createdAt || null,
      processorVersion: extraction?.processorVersion || null,
      inputSha256: extraction?.inputSha256 || null,
      evidenceVersion: data?.evidenceVersion || null,
      warnings: extraction?.warnings || [],
      coverage: {
        status: "partial",
        reason: "parser_inventory_unverified",
        extractedObservationCount: extraction?.observations?.length || 0,
        currentObservationCount: current.observations.length,
        sourcePagesAvailable:
          Boolean(extraction?.pages?.length) &&
          extraction.pages.every(
            (page) =>
              typeof page.text === "string" && Array.isArray(page.lines),
          ),
      },
      // Parsed pages remain untrusted evidence. Contact fields are never added here.
      pages: (extraction?.pages || []).map((page) => ({
        id: `report:${attached.id}:page:${page.number}`,
        number: page.number,
        text: asString(page.text),
        lines: (page.lines || []).map((line, index) => ({
          id: `report:${attached.id}:${line.id || `page:${page.number}:line:${index}`}`,
          text: asString(line.text),
          bounds: line.bounds || null,
        })),
      })),
    });
    groups.push(
      (view?.extraction?.labs || []).map((lab) => {
        const observation = current.observations[lab.observationIndex];
        const original = originalFor(
          observation,
          extraction.observations,
          lab.observationIndex,
          current.reviewed,
        );
        return {
          ...lab,
          sourceObservation: observation,
          originalObservation: original.observation,
          originalObservationIndex: original.index,
          reviewed: current.reviewed,
          extractionId: extraction.id,
          reviewRevision: data.reviewRevision || 0,
          attested: current.attested,
        };
      }),
    );
  }
  const observations = mergeReportLabs(groups).map((lab) => ({
    id: `observation:${lab.reportId}:${lab.extractionId}:${lab.reviewRevision}:${lab.observationIndex}`,
    uiLabId: lab.id,
    markerId: markerId(lab.sourceObservation.name),
    name: lab.sourceObservation.name,
    reportId: lab.reportId,
    extractionId: lab.extractionId,
    reviewRevision: lab.reviewRevision,
    observationIndex: lab.observationIndex,
    originalObservationIndex: lab.originalObservationIndex,
    page: lab.page,
    bounds: lab.bbox,
    // The immutable extraction and the clinician's correction are distinct.
    asRecorded: recordedFields(lab.originalObservation),
    asReviewed: lab.reviewed
      ? effectiveFields(lab.sourceObservation, lab.originalObservation)
      : null,
    current: effectiveFields(lab.sourceObservation, lab.originalObservation),
    parsed: {
      value: lab.value,
      comparator: lab.comparator,
      unit: lab.unit,
      unitInferred: !lab.sourceObservation.unit && Boolean(lab.unit),
      refLow: lab.refLow,
      refHigh: lab.refHigh,
      flag: lab.flag,
    },
    reviewStatus: lab.attested || lab.confirmed ? "confirmed" : "draft",
    issue: lab.note,
  }));
  const blockers = [];
  if (!knownVersions.has(version))
    blockers.push({ code: "unsupported_questionnaire", reference: version });
  for (const report of reports)
    if (!report.extractionId || report.status !== "ready")
      blockers.push({ code: "report_not_ready", reference: report.id });
    else if (report.reviewDecision === "needs_changes")
      blockers.push({
        code: "report_review_needs_changes",
        reference: report.id,
      });
  for (const observation of observations)
    if (observation.issue || observation.originalObservationIndex === null)
      blockers.push({
        code:
          observation.originalObservationIndex === null
            ? "unmatched_review_source"
            : "value_needs_confirmation",
        reference: observation.id,
      });
  const limitations = [];
  for (const report of reports) {
    if (!report.coverage.sourcePagesAvailable)
      limitations.push({
        code: "source_pages_unavailable",
        reference: report.id,
      });
    limitations.push({
      code: "parser_inventory_unverified",
      reference: report.id,
    });
    if (report.coverage.extractedObservationCount >= 500)
      limitations.push({
        code: "parser_observation_limit",
        reference: report.id,
      });
    if (
      report.coverage.currentObservationCount !==
      observations.filter((o) => o.reportId === report.id).length
    )
      limitations.push({ code: "unmapped_observations", reference: report.id });
  }
  for (const report of reports)
    if (
      report.extractionId &&
      !observations.some((o) => o.reportId === report.id)
    )
      limitations.push({ code: "no_structured_values", reference: report.id });
  for (const observation of observations)
    for (const [field, code] of [
      ["unit", "missing_unit"],
      ["referenceRange", "missing_range"],
      ["date", "missing_date"],
    ])
      if (!observation.current[field])
        limitations.push({ code, reference: observation.id });
  for (const observation of observations)
    if (observation.current.date && !observation.current.collectionDate)
      limitations.push({
        code: "collection_date_unverified",
        reference: observation.id,
      });
  // No band midpoint, pack-years, alcohol units or family diagnoses are guessed.
  const exactAge =
    version === "namat-hackathon-welcome-v2" &&
    /^\d+$/.test(submission.answers?.age || "")
      ? Number(submission.answers.age)
      : null;
  const questionnaire = {
    version,
    submittedAt: submission.created_at || null,
    exactAge,
    ageBand: exactAge === null ? submission.answers?.age || null : null,
    facts,
  };
  const knowledge = selectKnowledge({ facts, observations, version });
  const evidence = {
    schemaVersion: CASE_VERSION,
    questionnaire,
    reports,
    observations,
    assumptions: [],
    blockers,
    limitations,
    knowledge,
  };
  return {
    ...evidence,
    caseFingerprint: digest(evidence),
    assembledAt: new Date(now).toISOString(),
    readyForInterpretation: blockers.length === 0,
  };
}

/** Add catalogue details without inventing rules or discarding source attribution. */
export function extendCaseKnowledge(context, ids) {
  const extra = getKnowledgeRecords(ids);
  const {
    caseFingerprint: _previous,
    assembledAt,
    readyForInterpretation,
    ...evidence
  } = context;
  const merge = (left, right) => [
    ...new Map([...left, ...right].map((item) => [item.id, item])).values(),
  ];
  const knowledge = { ...evidence.knowledge };
  for (const [kind, key] of [
    ["marker", "markers"],
    ["screening", "screening"],
    ["bundle", "bundles"],
  ])
    knowledge[key] = merge(
      knowledge[key],
      extra.records
        .filter((item) => item.id.startsWith(`${kind}:`))
        .map((item) => item.record),
    );
  knowledge.claims = merge(knowledge.claims, extra.claims);
  knowledge.sources = merge(knowledge.sources, extra.sources);
  knowledge.catalogue = knowledge.catalogue.map((item) => ({
    ...item,
    detailIncluded: item.detailIncluded || ids.includes(item.id),
  }));
  evidence.knowledge = knowledge;
  return {
    ...evidence,
    caseFingerprint: digest(evidence),
    assembledAt,
    readyForInterpretation,
  };
}
