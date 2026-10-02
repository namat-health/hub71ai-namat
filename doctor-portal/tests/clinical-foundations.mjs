import assert from "node:assert/strict";
import test from "node:test";
import { validateGroundedAnalysis } from "../lib/clinical/analysis-contract.mjs";
import {
  buildCaseContext,
  extendCaseKnowledge,
} from "../lib/clinical/case-context.mjs";
import { knowledge } from "../lib/clinical/knowledge.mjs";
import { generatePlan } from "../lib/plan-generator.mjs";
import { report, submission } from "./fixtures/clinical-case.mjs";

const make = () =>
  buildCaseContext(structuredClone(submission), [structuredClone(report)], {
    now: Date.parse("2026-10-01T12:00:00Z"),
  });
function response(context) {
  const observation = context.observations[0];
  return {
    caseFingerprint: context.caseFingerprint,
    plan: {
      summaryShort: "Ferritin is below the printed range.",
      summaryLong: "The value needs review with the symptoms and history.",
      findings: [
        {
          title: "Ferritin below range",
          severity: "monitor",
          keyValues: "14 ng/mL",
          reasonShort: "Below the printed lower limit of 15.",
          reasonLong: "Clinical significance requires review.",
          evidence: [{ type: "lab", labId: observation.uiLabId }],
        },
      ],
      tests: [],
      followUps: [],
      sources: 0,
    },
    grounding: {
      findings: [
        {
          index: 0,
          kind: "observation",
          evidenceIds: [observation.id],
          claimIds: ["marker:ferritin:what_it_measures"],
          uncertainties: ["Collection date is not recorded."],
        },
      ],
      tests: [],
      existingResults: [],
      questionsForDoctor: [],
    },
  };
}
test("assembled evidence preserves provenance, unknowns and untrusted notes", () => {
  const c = make();
  assert.equal(c.readyForInterpretation, true);
  assert.equal(c.questionnaire.exactAge, 42);
  assert.equal(
    c.questionnaire.facts.find((f) => f.id === "answer:family").status,
    "unknown",
  );
  assert.equal(
    c.questionnaire.facts.find((f) => f.id === "answer:alcohol").status,
    "unknown",
  );
  assert.equal(
    c.questionnaire.facts.find((f) => f.id === "answer:history").status,
    "reported",
  );
  assert.equal(
    c.questionnaire.facts.find((f) => f.id === "note:medicines").value,
    "Biotin, dose unknown",
  );
  assert.equal(c.observations[0].asRecorded.date, null);
  assert.equal(c.observations[0].markerId, "ferritin");
  assert.ok(c.limitations.some((item) => item.code === "missing_date"));
  assert.ok(c.observations[0].id.includes(report.extraction.id));
  const json = JSON.stringify(c);
  assert.ok(!json.includes(submission.email));
  assert.ok(!json.includes(submission.first_name));
});
test("reviewed readings replace drafts and invalidate the case fingerprint", () => {
  const r = structuredClone(report);
  r.review = {
    decision: "corrected",
    createdAt: "2026-10-01T11:00:00Z",
    observations: [
      { ...r.extraction.observations[0], value: "41", confirmed: true },
    ],
  };
  r.reviewRevision = 1;
  const c = buildCaseContext(submission, [r]);
  assert.equal(c.observations[0].asRecorded.value, "14");
  assert.equal(c.observations[0].current.value, "41");
  assert.equal(c.observations[0].asReviewed.value, "41");
  assert.equal(c.observations[0].reviewStatus, "confirmed");
  assert.notEqual(c.caseFingerprint, make().caseFingerprint);
  assert.equal(
    c.observations[0].asRecorded.sourceText,
    "Ferritin 14 ng/mL 15-150",
  );
});
test("attached unavailable reports and uncertain units block generation; missing range stays unknown", () => {
  assert.equal(buildCaseContext(submission, []).readyForInterpretation, false);
  const r = structuredClone(report);
  r.extraction.observations[0].unit = null;
  r.extraction.observations[0].referenceRange = null;
  const c = buildCaseContext(submission, [r]);
  assert.equal(c.readyForInterpretation, false);
  assert.equal(c.observations[0].asRecorded.referenceRange, null);
  assert.equal(c.observations[0].parsed.refLow, null);
  assert.equal(c.observations[0].parsed.unitInferred, true);
});
test("older age bands never become fabricated exact ages", () => {
  const c = buildCaseContext(
    {
      ...submission,
      questionnaire_version: "namat-hackathon-welcome-v1",
      answers: { age: "41-50" },
    },
    [report],
  );
  assert.equal(c.questionnaire.exactAge, null);
  assert.equal(c.questionnaire.ageBand, "41-50");
});
test("all derived claims and sources resolve and preserve the source version hash", () => {
  assert.match(knowledge.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(knowledge.markers.length, 81);
  const sources = new Set(knowledge.sources.map((s) => s.id)),
    claims = new Map(knowledge.claims.map((c) => [c.id, c]));
  for (const record of [...knowledge.markers, ...knowledge.screening]) {
    for (const id of record.claimIds) assert.ok(claims.has(id));
    for (const id of record.sourceIds) assert.ok(sources.has(id));
  }
  for (const claim of claims.values())
    for (const id of claim.sourceIds) assert.ok(sources.has(id));
});
test("structured response rejects invented evidence, source claims and stale readings", () => {
  const c = make(),
    valid = response(c);
  assert.ok(validateGroundedAnalysis(valid, c));
  for (const alter of [
    (r) => (r.caseFingerprint = "old"),
    (r) => (r.grounding.findings[0].evidenceIds = ["observation:invented"]),
    (r) => (r.grounding.findings[0].claimIds = ["claim:invented"]),
    (r) => (r.plan.findings[0].evidence[0].labId = "another-patient"),
    (r) => (r.grounding.findings = []),
    (r) => (r.extra = "not allowed"),
  ]) {
    const invalid = structuredClone(valid);
    alter(invalid);
    assert.equal(validateGroundedAnalysis(invalid, c), null);
  }
});
test("connected generator does not return a fixed clinical sample", async () => {
  await assert.rejects(() => generatePlan({ caseContext: make() }), {
    code: "analysis_storage_unavailable",
  });
});

test("additional catalogue records bring their claims and sources into validation context", () => {
  const initial = make(),
    expanded = extendCaseKnowledge(initial, ["marker:apob"]);
  assert.ok(expanded.knowledge.markers.some((item) => item.id === "apob"));
  assert.ok(
    expanded.knowledge.claims.some((item) => item.recordId === "marker:apob"),
  );
  assert.notEqual(initial.caseFingerprint, expanded.caseFingerprint);
  assert.throws(() => extendCaseKnowledge(initial, ["marker:invented"]));
});
