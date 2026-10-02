import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCaseContext } from "../lib/clinical/case-context.mjs";
import {
  applyInventoryReviews,
  assembleInterpretation,
  interpretCase,
  prepareInterpretation,
} from "../lib/clinical/interpreter.mjs";
import { encodeModelInput } from "../lib/clinical/openai-provider.mjs";
import { report, submission } from "./fixtures/clinical-case.mjs";
import {
  config,
  memoryStore,
  offlineResponse,
} from "./fixtures/interpreter.mjs";

// Fictional transport/evidence cases. The mock verifier does not establish
// clinical accuracy; these tests check that the engine lets AI choose a finding
// and checks its evidence and ordering policy instead of prescribing the finding.
const originalBytes = Buffer.from(
  "%PDF-1.7\nFICTIONAL-ORIGINAL-TRANSPORT-SENTINEL\n%%EOF",
);
const sha256 = createHash("sha256").update(originalBytes).digest("hex");
const now = Date.now();
const completed = (output) => ({
  status: "completed",
  output,
  usage: {
    input_tokens: 1000,
    output_tokens: 500,
    input_tokens_details: { cached_tokens: 0 },
  },
  model: config.model,
  responseId: "offline-ai-led-test",
});

function fixture({ imageOnly = false, completeInventory = true } = {}) {
  const patient = structuredClone(submission);
  patient.notes.medicines = "Long-term proton-pump inhibitor use reported";
  const data = structuredClone(report);
  data.report.pageCount = 2;
  data.extraction.inputSha256 = sha256;
  data.extraction.observations.push({
    name: "Magnesium",
    value: "0.6",
    unit: "mmol/L",
    referenceRange: "0.7-1.0",
    date: null,
    page: 1,
    sourceText: "Magnesium 0.6 mmol/L 0.7-1.0",
    bounds: null,
  });
  data.extraction.pages[0].text += "\nMagnesium 0.6 mmol/L 0.7-1.0";
  data.extraction.pages.push({
    number: 2,
    unit: "pt",
    text: imageOnly ? "" : "Albumin 43 g/L 35-50",
    lines: [],
  });
  let context = buildCaseContext(patient, [data], { now });
  if (completeInventory)
    context = applyInventoryReviews(context, [
      {
        reportId: data.report.id,
        extractionId: data.extraction.id,
        reviewRevision: 0,
        createdAt: new Date(now).toISOString(),
        actorId: "fictional-reviewer",
      },
    ]);
  const prepared = prepareInterpretation(context, { now });
  const originals = [
    {
      reportId: data.report.id,
      filename: "report-1.pdf",
      mime: "application/pdf",
      bytes: originalBytes,
      pageCount: 2,
      sha256,
    },
  ];
  const input = {
    caseContext: context,
    submissionId: patient.id,
    inputSnapshot: {
      questionnaireVersion: patient.questionnaire_version,
      answers: patient.answers,
      notes: patient.notes,
      reports: [
        {
          reportId: data.report.id,
          extractionId: data.extraction.id,
          reviewRevision: 0,
        },
      ],
    },
    expiresAt: new Date(now + 7 * 86400000).toISOString(),
  };
  return { context, prepared, originals, input };
}

function draftFor(prepared) {
  const { caseFingerprint, summaryShort, summaryLong } =
    offlineResponse(prepared);
  const ferritin = prepared.context.observations.find(
    (row) => row.markerId === "ferritin",
  );
  const magnesium = prepared.context.observations.find(
    (row) => row.markerId === "magnesium",
  );
  const novel = "finding:medication-micronutrient-context";
  return {
    caseFingerprint,
    summaryShort,
    summaryLong,
    reportEvidence: [],
    findings: [
      {
        id: "finding:source-iron-context",
        title: "Review the recorded iron-store result",
        kind: "observation",
        priority: "review",
        evidenceIds: [ferritin.id],
        contraryEvidenceIds: [],
        claimIds: ["marker:ferritin:evidence_note"],
        reasonShort: "Review the printed result in clinical context.",
        reasonLong:
          "The recorded result merits review alongside the reported symptoms.",
        uncertainties: ["The specimen date has not been established."],
      },
      {
        id: novel,
        title: "Medicine context and micronutrient findings",
        kind: "possible_explanation",
        priority: "review",
        evidenceIds: [magnesium.id, "note:medicines", "answer:symptoms"],
        contraryEvidenceIds: [ferritin.id],
        claimIds: [
          "marker:magnesium:why_it_matters",
          "marker:vitamin-b12:why_it_matters",
        ],
        reasonShort:
          "Reported acid-suppressing medicine use may be relevant to the magnesium finding and broader micronutrient risk.",
        reasonLong:
          "Consider the reported medicine history alongside magnesium and symptoms. Iron-related findings offer another possible explanation for fatigue; the history does not establish a single cause.",
        uncertainties: [
          "Medicine duration, indication and other contributing factors need confirmation.",
        ],
      },
    ],
    actionLedger: [
      {
        knowledgeId: "marker:vitamin-b12",
        intent: "new",
        decision: "propose",
        findingIds: [novel],
        evidenceIds: ["note:medicines", "answer:symptoms"],
        claimIds: ["marker:vitamin-b12:why_it_matters"],
        reason:
          "Consider medicine-related micronutrient risk after confirming the history and checking for an existing result.",
      },
    ],
    questions: [
      {
        text: "What is the medicine indication and duration?",
        evidenceIds: ["note:medicines"],
      },
    ],
    observationCoverage: prepared.context.observations.map((row) => ({
      observationId: row.id,
      disposition: "addressed",
      findingIds: [
        row.markerId === "magnesium" ? novel : "finding:source-iron-context",
      ],
      reason: "Discussed in the source-linked finding.",
    })),
    reportCoverage: prepared.context.reports.flatMap((record) =>
      record.pages.map((page) => ({
        reportId: record.id,
        page: page.number,
        status: "reviewed",
        reason: "Reviewed the complete supplied page.",
      })),
    ),
  };
}

function harness(settings) {
  const h = fixture(settings),
    store = memoryStore(),
    calls = [];
  h.loadCount = 0;
  h.output = () => draftFor(h.prepared);
  h.verdict = { supported: true, issues: [] };
  h.input.loadReportInputs = async () => {
    h.loadCount++;
    return h.originals;
  };
  const provider = {
    config,
    async estimate(encoded, originals, verification) {
      calls.push({ kind: "estimate", encoded, originals, verification });
      return 1_000_000;
    },
    async synthesize(encoded, originals) {
      calls.push({ kind: "synthesize", encoded, originals });
      return completed(h.output());
    },
    async verify(encoded, originals) {
      calls.push({ kind: "verify", encoded, originals });
      return completed(h.verdict);
    },
  };
  return Object.assign(h, { store, calls, provider });
}

test("AI can choose a cross-domain finding and catalogue test outside the deterministic pattern and candidate menu", () => {
  const h = fixture();
  assert.ok(
    !h.prepared.evaluation.candidates.some(
      (item) => item.knowledgeId === "marker:vitamin-b12",
    ),
  );
  assert.ok(
    !h.prepared.evaluation.patterns.some(
      (item) => item.id === "finding:medication-micronutrient-context",
    ),
  );
  const raw = draftFor(h.prepared);
  const analysis = assembleInterpretation(raw, h.prepared, h.originals);
  const finding = analysis.grounding.findings.find(
    (item) => item.id === "finding:medication-micronutrient-context",
  );
  assert.equal(finding.kind, "possible_explanation");
  assert.deepEqual(
    finding.contraryEvidenceIds,
    raw.findings[1].contraryEvidenceIds,
  );
  assert.equal(analysis.actionLedger[0].knowledgeId, "marker:vitamin-b12");
  assert.equal(analysis.actionLedger[0].policyStatus, "eligible");
  assert.ok(
    analysis.plan.tests.some((item) => item.id === "marker-vitamin-b12"),
  );
  const encoded = JSON.parse(
    encodeModelInput(h.prepared.context, h.prepared.evaluation, h.originals),
  );
  assert.equal(encoded.evaluation, undefined);
  assert.equal(encoded.patterns, undefined);
  assert.equal(encoded.candidates, undefined);
  assert.ok(
    encoded.knowledge.claims.some(
      (claim) => claim.id === "marker:vitamin-b12:why_it_matters",
    ),
  );
  assert.equal(encoded.reports[0].pages[1].text, "Albumin 43 g/L 35-50");
});

test("uncaptured source rows can be cited exactly, while invented citations, quote text, pages and catalogue IDs fail closed", () => {
  const h = fixture();
  const valid = draftFor(h.prepared);
  valid.reportEvidence.push({
    id: "citation:albumin",
    reportId: report.report.id,
    page: 2,
    quote: "Albumin 43 g/L 35-50",
  });
  valid.findings[1].contraryEvidenceIds.push("citation:albumin");
  assert.equal(
    assembleInterpretation(valid, h.prepared, h.originals).evidence
      .reportEvidence[0].verification,
    "text_match",
  );
  for (const change of [
    (raw) => {
      raw.findings[1].evidenceIds.push("citation:invented");
    },
    (raw) => {
      raw.reportEvidence[0].page = 3;
    },
    (raw) => {
      raw.reportEvidence[0].reportId = "unknown-report";
    },
    (raw) => {
      raw.reportEvidence[0].id = "answer:symptoms";
    },
    (raw) => {
      raw.actionLedger[0].knowledgeId = "marker:invented-treatment";
    },
    (raw) => {
      raw.findings[1].claimIds = ["marker:invented:claim"];
    },
  ]) {
    const changed = structuredClone(valid);
    change(changed);
    assert.throws(
      () => assembleInterpretation(changed, h.prepared, h.originals),
      { code: "invalid_analysis" },
    );
  }
  // No original image is available in this direct assembly: a nonmatching quote
  // has no visual fallback and must be rejected by the literal-source check.
  const fabricated = structuredClone(valid);
  fabricated.reportEvidence[0].quote = "Albumin 99 g/L";
  assert.throws(() => assembleInterpretation(fabricated, h.prepared), {
    code: "invalid_analysis",
  });
});

test("every original page and parsed observation must be accounted for exactly once", () => {
  const h = fixture(),
    valid = draftFor(h.prepared);
  for (const change of [
    (raw) => {
      raw.reportCoverage.pop();
    },
    (raw) => {
      raw.reportCoverage[1] = raw.reportCoverage[0];
    },
    (raw) => {
      raw.reportCoverage[1].page = 3;
    },
    (raw) => {
      raw.observationCoverage.pop();
    },
    (raw) => {
      raw.observationCoverage[1] = raw.observationCoverage[0];
    },
    (raw) => {
      raw.observationCoverage[1].observationId = "unknown-row";
    },
    (raw) => {
      raw.observationCoverage[1].findingIds = [];
    },
    (raw) => {
      raw.observationCoverage[1].findingIds = ["finding:source-iron-context"];
    },
  ]) {
    const raw = structuredClone(valid);
    change(raw);
    assert.throws(() => assembleInterpretation(raw, h.prepared, h.originals), {
      code: "invalid_analysis",
    });
  }
  const extraPage = [{ ...h.originals[0], pageCount: 3 }];
  assert.throws(() => assembleInterpretation(valid, h.prepared, extraPage), {
    code: "invalid_analysis",
  });
});

test("inventory uncertainty and visual-only evidence keep an AI test proposal visible but nonselectable", () => {
  const unknown = fixture({ completeInventory: false });
  const draft = draftFor(unknown.prepared);
  const conditional = assembleInterpretation(
    draft,
    unknown.prepared,
    unknown.originals,
  );
  assert.equal(conditional.actionLedger[0].modelDecision, "propose");
  assert.equal(conditional.actionLedger[0].decision, "defer");
  assert.equal(conditional.actionLedger[0].policyStatus, "needs_context");
  assert.equal(conditional.plan.tests.length, 0);
  const visual = fixture({ imageOnly: true });
  const visualDraft = draftFor(visual.prepared);
  visualDraft.reportEvidence.push({
    id: "citation:visual",
    reportId: report.report.id,
    page: 2,
    quote: "Printed medicine note",
  });
  visualDraft.findings[1].evidenceIds.push("citation:visual");
  const assembled = assembleInterpretation(
    visualDraft,
    visual.prepared,
    visual.originals,
  );
  assert.equal(
    assembled.evidence.reportEvidence[0].verification,
    "visual_unconfirmed",
  );
  assert.equal(assembled.actionLedger[0].policyStatus, "needs_context");
  assert.equal(assembled.plan.tests.length, 0);
  assert.ok(
    assembled.grounding.findings[1].uncertainties.some((item) =>
      item.includes("visual reading"),
    ),
  );
});

test("originals go to interpretation, semantic verification and token estimates but never into stored data; cache skips the loader", async () => {
  const h = harness();
  const result = await interpretCase(h.input, {
    store: h.store,
    provider: h.provider,
    now,
  });
  assert.equal(h.loadCount, 1);
  assert.deepEqual(
    h.calls.map((item) => item.kind),
    ["estimate", "synthesize", "estimate", "verify"],
  );
  for (const call of h.calls) {
    assert.strictEqual(call.originals, h.originals);
    assert.deepEqual(call.originals[0].bytes, originalBytes);
  }
  assert.deepEqual(
    h.calls
      .filter((item) => item.kind === "estimate")
      .map((item) => item.verification),
    [false, true],
  );
  const verifier = JSON.parse(
    h.calls.find((item) => item.kind === "verify").encoded,
  );
  assert.equal(verifier.policyReview[0].knowledgeId, "marker:vitamin-b12");
  assert.equal(
    verifier.draft.findings[1].id,
    "finding:medication-micronutrient-context",
  );
  assert.equal(h.store.runs.length, 1);
  const assertNoBinary = (value) => {
    assert.ok(!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer));
    if (value && typeof value === "object")
      for (const item of Object.values(value)) assertNoBinary(item);
  };
  assertNoBinary(h.store.runs[0]);
  const stored = JSON.stringify(h.store.runs[0]);
  assert.ok(!stored.includes("FICTIONAL-ORIGINAL-TRANSPORT-SENTINEL"));
  assert.ok(!stored.includes(originalBytes.toString("base64")));
  assert.ok(!stored.includes('"bytes"'));
  assert.equal(h.store.runs[0].metadata.originals[0].sha256, sha256);
  assert.equal(h.store.reservations.size, 2);
  assert.ok(
    [...h.store.reservations.values()].every(
      (reservation) => reservation.actualMicros === 7000,
    ),
  );
  const again = await interpretCase(
    {
      ...h.input,
      loadReportInputs: async () => {
        throw new Error("A cached analysis must not download originals");
      },
    },
    { store: h.store, provider: h.provider, now },
  );
  assert.equal(again.cached, true);
  assert.equal(again.runId, result.runId);
  assert.equal(h.calls.length, 4);
});

test("a semantic rejection of invented visual text, unsupported inference or material omission prevents persistence after one correction and accounts for all four calls", async () => {
  for (const scope of ["source", "finding", "omission"]) {
    const h = harness({ imageOnly: true });
    h.output = () => {
      const raw = draftFor(h.prepared);
      raw.reportEvidence.push({
        id: "citation:unconfirmed",
        reportId: report.report.id,
        page: 2,
        quote: "Invented visual reading",
      });
      raw.findings[1].evidenceIds.push("citation:unconfirmed");
      return raw;
    };
    h.verdict = {
      supported: false,
      issues: [
        {
          scope,
          index: 0,
          reason:
            "The cited visual reading or inference is unsupported by the original report.",
        },
      ],
    };
    await assert.rejects(
      interpretCase(h.input, { store: h.store, provider: h.provider, now }),
      { code: "invalid_analysis" },
    );
    assert.equal(h.store.runs.length, 0);
    assert.equal(h.store.reservations.size, 4);
    assert.ok(
      [...h.store.reservations.values()].every(
        (reservation) => reservation.actualMicros === 7000,
      ),
    );
    assert.equal(h.calls.filter((item) => item.kind === "verify").length, 2);
  }
});

test("missing originals or a missing multimodal token estimator blocks before any model call or spend reservation", async () => {
  for (const missing of ["original", "estimator"]) {
    const h = harness();
    if (missing === "original") h.input.loadReportInputs = async () => [];
    else delete h.provider.estimate;
    await assert.rejects(
      interpretCase(h.input, { store: h.store, provider: h.provider, now }),
      {
        code:
          missing === "original" ? "case_not_ready" : "analysis_configuration",
      },
    );
    assert.equal(h.store.reservations.size, 0);
    assert.equal(h.store.runs.length, 0);
    assert.equal(h.calls.length, 0);
  }
});
