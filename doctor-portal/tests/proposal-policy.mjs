import assert from "node:assert/strict";
import test from "node:test";
import { knowledge } from "../lib/clinical/knowledge.mjs";
import {
  evaluateModelProposal,
  PROPOSAL_POLICY_VERSION,
} from "../lib/clinical/proposal-policy.mjs";

const evaluatedAt = "2026-10-02T12:00:00Z";
const evidenceId = "note:clinical-context";
const completeKnowledge = {
  ...knowledge,
  catalogue: [
    ...knowledge.markers.map((row) => ({ id: `marker:${row.id}` })),
    ...knowledge.screening.map((row) => ({ id: `screening:${row.id}` })),
  ],
};
function context(extra = {}) {
  return {
    knowledge: completeKnowledge,
    questionnaire: {
      exactAge: 42,
      facts: [
        {
          id: evidenceId,
          key: "clinical-context",
          kind: "note",
          value: "Symptoms reported",
          text: "Symptoms reported",
          status: "reported",
        },
      ],
    },
    reports: [
      {
        id: "one",
        coverageStatus: "complete",
        pages: [
          {
            id: "report:one:page:1",
            number: 1,
            text: "Clinical report text",
            lines: [{ id: "report:one:line:1", text: "Clinical report text" }],
          },
        ],
      },
    ],
    observations: [],
    ...extra,
  };
}
function proposal(knowledgeId = "marker:ferritin", extra = {}) {
  const claim = completeKnowledge.claims.find(
    (row) => row.recordId === knowledgeId,
  );
  return {
    knowledgeId,
    evidenceIds: [evidenceId],
    claimIds: claim ? [claim.id] : [],
    intent: "new",
    ...extra,
  };
}
function lab(markerId = "ferritin", date = "2026-09-20", extra = {}) {
  return {
    id: `observation:${markerId}`,
    markerId,
    page: 1,
    reviewStatus: "draft",
    asRecorded: {
      value: "25",
      unit: "µg/L",
      referenceRange: "15-150",
      date,
      dateKind: "collection",
      sourceText: `${markerId} 25 µg/L`,
    },
    parsed: { value: 25, unitInferred: false },
    ...extra,
  };
}
const run = (p = proposal(), c = context(), evaluation = {}) =>
  evaluateModelProposal(p, c, { evaluatedAt, ...evaluation });
const withFacts = (facts) =>
  context({
    questionnaire: {
      exactAge: 42,
      facts: [...context().questionnaire.facts, ...facts],
    },
  });
const answer = (key, value, status = "reported") => ({
  id: `answer:${key}`,
  key,
  value,
  kind: "answer",
  status,
});

test("policy is pure, versioned and permits AI-originated catalogue proposals without deterministic triggers", () => {
  const p = proposal("marker:coeliac-ttg-iga"),
    c = context();
  const before = structuredClone({ p, c });
  const result = run(p, c, { patterns: [], candidates: [] });
  assert.equal(result.status, "eligible");
  assert.match(PROPOSAL_POLICY_VERSION, /^namat-proposal-policy-/);
  assert.match(result.reasons[0], /not clinical sign-off/);
  assert.deepEqual({ p, c }, before);
  assert.deepEqual(
    Object.keys(result).sort(),
    ["status", "reasons", "evidenceIds", "knowledgeId"].sort(),
  );
});

test("full catalogue markers outside the original six domains can pass", () => {
  assert.equal(run(proposal("marker:vitamin-d-25-oh")).status, "eligible");
});

test("unknown tests and bundle bypasses are blocked; known index-only records need details", () => {
  assert.equal(run(proposal("marker:invented")).status, "blocked");
  assert.equal(run(proposal("bundle:hlmcs-baseline-bloods")).status, "blocked");
  const c = context({ knowledge: { ...completeKnowledge, markers: [] } });
  assert.equal(run(proposal(), c).status, "needs_context");
});

test("selectedKnowledge is the trusted complete snapshot when provided", () => {
  assert.equal(
    run(
      proposal(),
      context({ knowledge: {}, selectedKnowledge: completeKnowledge }),
    ).status,
    "eligible",
  );
});

test("explicit not-offered records and exact exclusion names block proposals", () => {
  assert.equal(run(proposal("screening:carotid-ultrasound")).status, "blocked");
  const c = context({
    knowledge: { ...completeKnowledge, notOffered: [{ test: "Ferritin" }] },
  });
  assert.equal(run(proposal(), c).status, "blocked");
  // A conditional exclusion sentence is not silently converted into a blanket ban.
  c.knowledge.notOffered = [{ test: "Ferritin without an indication" }];
  assert.equal(run(proposal(), c).status, "eligible");
});

test("unknown or missing evidence and claims block, without retaining invented evidence IDs", () => {
  for (const change of [
    { evidenceIds: [] },
    { evidenceIds: ["invented"] },
    { claimIds: [] },
    { claimIds: ["invented"] },
    { intent: "automatic" },
  ]) {
    const result = run(proposal(undefined, change));
    assert.equal(result.status, "blocked");
    assert.ok(!result.evidenceIds.includes("invented"));
  }
});

test("bare report page and line references need a verified clinical excerpt", () => {
  for (const id of ["report:one:page:1", "report:one:line:1"])
    assert.equal(
      run(proposal(undefined, { evidenceIds: [id] })).status,
      "needs_context",
    );
  const c = context();
  c.reports[0].pages[0].text = "";
  assert.equal(
    run(proposal(undefined, { evidenceIds: ["report:one:page:1"] }), c).status,
    "needs_context",
  );
});

test("verified model-originated excerpts can support proposals absent from the regex inventory", () => {
  const c = context({
    reportEvidence: [
      {
        id: "citation:one",
        reportId: "one",
        page: 1,
        quote: "Clinical report text",
        verification: "text_match",
      },
    ],
  });
  const p = proposal(undefined, { evidenceIds: ["citation:one"] });
  assert.equal(run(p, c).status, "eligible");
  c.reportEvidence[0].verification = "visual_unconfirmed";
  const result = run(p, c);
  assert.equal(result.status, "needs_context");
  assert.match(result.reasons[0], /clinician must confirm/);
  c.reportEvidence[0].verification = "text_match";
  c.reportEvidence[0].quote = "";
  assert.equal(run(p, c).status, "needs_context");
});

test("a questionnaire unknown is not evidence of a negative answer", () => {
  const c = withFacts([answer("pregnancy", "no", "unknown")]);
  assert.equal(
    run(proposal(undefined, { evidenceIds: ["answer:pregnancy"] }), c).status,
    "needs_context",
  );
});

test("adult age must be established; minors remain outside demonstration ordering checks", () => {
  for (const age of [null, undefined, "42"])
    assert.equal(
      run(
        proposal(),
        context({
          questionnaire: { ...context().questionnaire, exactAge: age },
        }),
      ).status,
      "needs_context",
    );
  assert.equal(
    run(
      proposal(),
      context({ questionnaire: { ...context().questionnaire, exactAge: 17 } }),
    ).status,
    "blocked",
  );
});

test("explicit pregnancy and treatment positives block, while absence does not become a negative", () => {
  for (const key of ["pregnancy", "treatment"])
    assert.equal(
      run(proposal(), withFacts([answer(key, "yes")])).status,
      "blocked",
    );
  assert.equal(
    run(proposal(), withFacts([answer("pregnancy", "yes", "unknown")])).status,
    "eligible",
  );
  const marker = completeKnowledge.markers.find((row) => row.id === "ferritin");
  const c = context({
    knowledge: {
      ...completeKnowledge,
      markers: [{ ...marker, requires_pregnancy_status: true }],
    },
  });
  assert.equal(run(proposal(), c).status, "needs_context");
  c.clinicianChecks = { "marker:ferritin": { pregnancyStatus: "no" } };
  assert.equal(run(proposal(), c).status, "eligible");
});

test("consent and shared decisions must be trusted recorded checks, never model flags", () => {
  const p = proposal("marker:amh", {
    consentRecorded: true,
    sharedDecisionRecorded: true,
  });
  assert.equal(run(p).status, "needs_context");
  const c = context({
    clinicianChecks: { "marker:amh": { consentRecorded: true } },
  });
  assert.equal(run(p, c).status, "needs_context");
  c.clinicianChecks["marker:amh"].sharedDecisionRecorded = true;
  assert.equal(run(p, c).status, "eligible");
  c.clinicianChecks["marker:amh"].contraindicationPresent = true;
  assert.equal(run(p, c).status, "blocked");
});

test("known contraindication requirements need review without inventing contraindications", () => {
  const marker = completeKnowledge.markers.find((row) => row.id === "ferritin");
  const c = context({
    knowledge: {
      ...completeKnowledge,
      markers: [
        { ...marker, contraindications: ["A source-defined contraindication"] },
      ],
    },
  });
  assert.equal(run(proposal(), c).status, "needs_context");
  c.clinicianChecks = {
    "marker:ferritin": { contraindicationsReviewed: true },
  };
  assert.equal(run(proposal(), c).status, "eligible");
});

test("safety blockers stop test selection without imposing deterministic candidate membership", () => {
  const result = run(proposal(), context(), {
    blockers: [
      {
        blocks: "test_proposals",
        reason: "Review the explicit urgent result.",
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.match(result.reasons[0], /urgent/);
});

test("screening requires relevant anatomy and demographic review, without executing prose risk rules", () => {
  assert.equal(run(proposal("screening:mammography")).status, "needs_context");
  assert.equal(
    run(proposal("screening:mammography"), withFacts([answer("sex", "female")]))
      .status,
    "eligible",
  );
  const c = withFacts([answer("sex", "female")]);
  c.questionnaire.exactAge = 22;
  assert.equal(
    run(proposal("screening:mammography"), c).status,
    "needs_context",
  );
});

test("partial inventories leave visible proposals needing context; signed complete inventories unlock selection", () => {
  const c = context({
    reports: [{ id: "one", coverage: { status: "partial" } }],
  });
  assert.equal(run(proposal(), c).status, "needs_context");
  c.reportCoverageComplete = true;
  assert.equal(run(proposal(), c).status, "eligible");
  assert.equal(
    run(proposal(), context({ reports: [] })).status,
    "needs_context",
  );
});

test("clear source-backed draft results prevent redundant new tests, even with partial inventory", () => {
  const c = context({
    observations: [lab()],
    reports: [{ id: "one", coverage: { status: "partial" } }],
  });
  const result = run(proposal(), c);
  assert.equal(result.status, "already_available");
  assert.ok(result.evidenceIds.includes("observation:ferritin"));
});

test("current corrected values and collection dates control reuse; originals remain untouched", () => {
  const row = lab("ferritin", "2026-09-20");
  row.current = { ...row.asRecorded, date: "2025-01-01", value: "26" };
  row.parsed.value = 26;
  const c = context({ observations: [row] });
  assert.equal(run(proposal(), c).status, "eligible");
  assert.equal(c.observations[0].asRecorded.date, "2026-09-20");
});

test("report dates, invalid collection dates and future dates cannot establish reuse", () => {
  for (const raw of [
    { dateKind: "report" },
    { date: "2026-02-30" },
    { date: "2027-01-01" },
    { date: null },
  ]) {
    const row = lab();
    row.current = { ...row.asRecorded, ...raw };
    assert.equal(
      run(proposal(), context({ observations: [row] })).status,
      "needs_context",
    );
  }
});

test("collectionDate is authoritative and calendar-month boundaries clamp correctly", () => {
  const row = lab("ferritin", "2026-09-20");
  row.current = { ...row.asRecorded, collectionDate: "2025-08-31" };
  assert.equal(
    run(proposal(), context({ observations: [row] }), {
      evaluatedAt: "2026-02-27T23:00:00Z",
    }).status,
    "already_available",
  );
  assert.equal(
    run(proposal(), context({ observations: [row] }), {
      evaluatedAt: "2026-02-28T00:00:00Z",
    }).status,
    "eligible",
  );
});

test("once-in-lifetime results remain available without fabricated date or fixed unit conversion", () => {
  const row = lab("lipoprotein-a", null);
  row.asRecorded.unit = "nmol/L";
  assert.equal(
    run(proposal("marker:lipoprotein-a"), context({ observations: [row] }))
      .status,
    "already_available",
  );
});

test("ambiguous duplicates, unknown chronology and inconsistent readings require context", () => {
  const first = lab(),
    second = lab("ferritin", "2026-09-20", { id: "second" });
  second.asRecorded.value = "26";
  second.parsed.value = 26;
  assert.equal(
    run(proposal(), context({ observations: [first, second] })).status,
    "needs_context",
  );
  second.asRecorded.date = null;
  assert.equal(
    run(proposal(), context({ observations: [first, second] })).status,
    "needs_context",
  );
});

test("a reliable newest result can supersede an older dated reading", () => {
  const old = lab("ferritin", "2025-01-01", { id: "old" });
  assert.equal(
    run(proposal(), context({ observations: [old, lab()] })).status,
    "already_available",
  );
});

test("extraction uncertainty cannot establish available results or support eligible proposals", () => {
  for (const extra of [
    { issue: "Uncertain" },
    { page: null },
    { parsed: { value: 26 } },
    { parsed: { value: 25, unitInferred: true } },
  ]) {
    const row = lab("ferritin", "2026-09-20", extra);
    assert.equal(
      run(proposal(), context({ observations: [row] })).status,
      "needs_context",
    );
    assert.equal(
      run(
        proposal("marker:coeliac-ttg-iga", { evidenceIds: [row.id] }),
        context({ observations: [row] }),
      ).status,
      "needs_context",
    );
  }
});

test("a qualitative source result does not need invented units", () => {
  const row = lab("hbsag");
  row.asRecorded.value = "Non-reactive";
  row.asRecorded.unit = "";
  row.parsed = {};
  const c = context({
    observations: [row],
    clinicianChecks: {
      "marker:hbsag": { consentRecorded: true, sharedDecisionRecorded: true },
    },
  });
  assert.equal(run(proposal("marker:hbsag"), c).status, "already_available");
});

test("repeat intent is visible for clinician judgment but cannot bypass reuse or never-repeat instructions", () => {
  assert.equal(
    run(
      proposal(undefined, { intent: "repeat" }),
      context({ observations: [lab()] }),
    ).status,
    "needs_context",
  );
  assert.equal(
    run(proposal(undefined, { intent: "repeat" })).status,
    "needs_context",
  );
  const p = proposal("marker:lipoprotein-a", { intent: "repeat" });
  const result = run(p, context({ observations: [lab("lipoprotein-a")] }));
  assert.equal(result.status, "needs_context");
  assert.match(result.reasons.at(-1), /not to repeat/);
});
