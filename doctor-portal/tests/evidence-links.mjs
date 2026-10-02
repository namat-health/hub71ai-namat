import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLink } from "../lib/clinical/evidence-links.mjs";
import { validatePlan } from "../lib/plan.mjs";

const reportId = "d4c2d7d1-39c6-4c01-a988-98248dd2513a";
const analysis = {
  evidence: {
    observations: [
      {
        id: "observation:ferritin",
        uiLabId: "ferritin",
        reportId,
        page: 2,
        name: "Ferritin",
        current: { value: "24", unit: "ng/mL" },
        asRecorded: { value: "14", unit: "ng/mL" },
        bounds: { x: 1, y: 2, width: 3, height: 4 },
      },
    ],
    facts: [
      { id: "answer:symptoms", key: "symptoms", text: "Reported fatigue" },
    ],
    reportPages: [{ id: "report:page:2", reportId, page: 2 }],
    reportEvidence: [
      {
        id: "citation:matched",
        reportId,
        page: 2,
        quote: "ApoB 1.2 g/L",
        verification: "text_match",
      },
      {
        id: "citation:visual",
        reportId,
        page: 2,
        quote: "Printed clinical note",
        verification: "visual_unconfirmed",
      },
    ],
  },
};

test("evidence links resolve corrected values, questionnaire facts, complete report pages and uncaptured quotes", () => {
  const observation = evidenceLink(analysis, "observation:ferritin");
  assert.equal(observation.label, "Ferritin 24 ng/mL");
  assert.deepEqual(observation.bbox, analysis.evidence.observations[0].bounds);
  assert.equal(observation.reportId, reportId);
  assert.deepEqual(
    evidenceLink(analysis, { type: "lab", labId: "ferritin" }),
    observation,
  );
  assert.deepEqual(evidenceLink(analysis, "answer:symptoms"), {
    id: "answer:symptoms",
    type: "questionnaire",
    key: "symptoms",
    label: "Reported fatigue",
  });
  assert.deepEqual(
    evidenceLink(analysis, {
      type: "report",
      reportId,
      page: 2,
      label: "Printed result",
    }),
    {
      id: "report:page:2",
      type: "report",
      reportId,
      page: 2,
      bbox: null,
      label: "Printed result",
    },
  );
  assert.equal(evidenceLink(analysis, "report:page:2").page, 2);
  for (const id of ["citation:matched", "citation:visual"]) {
    const link = evidenceLink(analysis, id);
    assert.equal(link.type, "report");
    assert.equal(link.reportId, reportId);
    assert.equal(link.page, 2);
    assert.equal(
      link.quote,
      analysis.evidence.reportEvidence.find((item) => item.id === id).quote,
    );
  }
  assert.equal(
    evidenceLink(analysis, "citation:visual").verification,
    "visual_unconfirmed",
  );
});

test("unknown pages, reports, citations and URLs cannot become navigation targets", () => {
  for (const reference of [
    "citation:invented",
    "https://external.invalid/report",
    { type: "report", reportId, page: 3, label: "Unknown page" },
    { type: "report", reportId: "other-report", page: 2 },
    { type: "report", url: "https://external.invalid/report", page: 2 },
    { type: "questionnaire", key: "not_recorded" },
  ])
    assert.equal(evidenceLink(analysis, reference), null);
  assert.equal(evidenceLink(null, "report:page:2"), null);
});

const makePlan = (evidence) => ({
  summaryShort: "Fictional source-link test.",
  summaryLong: "This test validates navigation, not a clinical interpretation.",
  findings: [
    {
      title: "Source-linked finding",
      severity: "monitor",
      keyValues: "",
      reasonShort: "Review the cited original page.",
      reasonLong: "Confirm the source quote against the original report.",
      evidence: [evidence],
    },
  ],
  tests: [],
  followUps: [],
  sources: 0,
});

test("plan contract preserves valid original-page evidence and rejects invalid targets", () => {
  const valid = {
    type: "report",
    reportId,
    page: 2,
    label: "Printed ApoB result",
    url: "https://discard.invalid",
  };
  assert.deepEqual(validatePlan(makePlan(valid)).findings[0].evidence, [
    {
      type: "report",
      reportId,
      page: 2,
      label: "Printed ApoB result",
    },
  ]);
  assert.ok(validatePlan(makePlan({ ...valid, reportId: "legacy-0" })));
  for (const change of [
    { reportId: "https://external.invalid" },
    { reportId: "legacy-3" },
    { page: 0 },
    { page: -1 },
    { page: 51 },
    { page: "2" },
    { page: 1.5 },
    { label: "" },
    { label: "x".repeat(101) },
  ])
    assert.equal(validatePlan(makePlan({ ...valid, ...change })), null);
});
