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
export const CASE_VERSION = "namat-case-v1";
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
      status: attached.status,
      extractionId: extraction?.id || null,
      reviewRevision: data?.reviewRevision ?? 0,
      processorVersion: extraction?.processorVersion || null,
      warnings: extraction?.warnings || [],
      // Parsed pages remain untrusted evidence. Contact fields are never added here.
      pages: (extraction?.pages || []).map((page) => ({
        id: `report:${attached.id}:page:${page.number}`,
        number: page.number,
        text: asString(page.text),
        lines: (page.lines || []).map((line) => ({
          text: asString(line.text),
          bounds: line.bounds || null,
        })),
      })),
    });
    groups.push(
      (view?.extraction?.labs || []).map((lab) => {
        const observation = current.observations[lab.observationIndex];
        return {
          ...lab,
          sourceObservation: observation,
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
    page: lab.page,
    bounds: lab.bbox,
    // Keep the stored reading separate from parsed or inferred display fields.
    asRecorded: {
      value: lab.sourceObservation.value,
      unit: lab.sourceObservation.unit || null,
      referenceRange: lab.sourceObservation.referenceRange || null,
      date: lab.sourceObservation.date || null,
      sourceText: lab.sourceObservation.sourceText || null,
    },
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
  for (const observation of observations)
    if (observation.issue)
      blockers.push({
        code: "value_needs_confirmation",
        reference: observation.id,
      });
  const limitations = [];
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
      if (!observation.asRecorded[field])
        limitations.push({ code, reference: observation.id });
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
    assumptions: [
      {
        id: "assumption:fasting",
        text: "Fasting preparation is assumed for this demo; it is not verified patient evidence.",
      },
    ],
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
