import assert from "node:assert/strict";
import test from "node:test";
import { knowledge } from "../lib/clinical/knowledge.mjs";
import {
  evaluateCase,
  RULE_KNOWLEDGE_IDS,
  RULES_VERSION,
} from "../lib/clinical/rules.mjs";

const NOW = Date.parse("2026-10-02T12:00:00Z");
function observation(markerId, value, range, unit = "g/L", options = {}) {
  const id = options.id || `observation:${markerId}`;
  return {
    id,
    markerId,
    name: markerId,
    reportId: "report:one",
    page: 1,
    reviewStatus: "draft",
    issue: null,
    asRecorded: {
      value: String(value),
      unit,
      referenceRange: range,
      date: "2026-09-20",
      dateKind: "collection",
      sourceText: `${markerId} ${value} ${unit} ${range || ""}`,
    },
    parsed: { value: Number(value), unit, unitInferred: false },
    ...options,
  };
}
const answer = (key, value, status = "reported") => ({
  id: `answer:${key}`,
  kind: "answer",
  key,
  value,
  status,
});
function context(observations = [], facts = [], extra = {}) {
  return {
    observations,
    questionnaire: { exactAge: 42, facts },
    reports: [{ id: "report:one", coverageStatus: "complete" }],
    ...extra,
  };
}
const run = (c, now = NOW) => evaluateCase(c, { now });
const candidate = (result, marker) =>
  result.candidates.find((item) => item.id === `test:${marker}`);
const pattern = (result, id) =>
  result.patterns.find((item) => item.id === `pattern:${id}`);
const lowHb = () => observation("haemoglobin", 110, "120-160");
const a1c = () => observation("hba1c", 6.1, "4-5.6", "%");

test("rules are pure, versioned, and cover every supplied observation across six domains", () => {
  const c = context([
    observation("ldl-cholesterol", 2.0, "0-3", "mmol/L"),
    observation("hba1c", 5.2, "4-5.6", "%"),
    observation("haemoglobin", 140, "120-160"),
    observation("creatinine", 75, "60-110", "µmol/L"),
    observation("alt", 20, "0-40", "U/L"),
    observation("tsh", 2, "0.4-4", "mIU/L"),
    observation("random-unknown", 5, "1-8", "unmapped-unit"),
  ]);
  const before = structuredClone(c),
    result = run(c);
  assert.deepEqual(c, before);
  assert.equal(result.version, RULES_VERSION);
  assert.equal(result.coverage.length, c.observations.length);
  assert.equal(new Set(result.coverage.map((row) => row.domain)).size, 7);
  assert.equal(result.coverage.at(-1).status, "outside_scope");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.blockers.length, 0);
});

test("low haemoglobin supports ferritin, but high haemoglobin does not", () => {
  const low = run(context([lowHb()]));
  assert.ok(candidate(low, "ferritin").allowedDecisions.includes("propose"));
  assert.ok(pattern(low, "iron-assessment"));
  const high = run(context([observation("haemoglobin", 170, "120-160")]));
  assert.equal(candidate(high, "ferritin"), undefined);
  assert.ok(pattern(high, "high-haemoglobin"));
});

test("fatigue is literal; goals, cycle changes and intentional/unspecified weight loss do not become iron indications", () => {
  assert.ok(
    candidate(run(context([], [answer("symptoms", ["energy"])])), "ferritin"),
  );
  for (const fact of [
    answer("performance", ["energy"]),
    answer("hormones", ["cycle"]),
    answer("weight", "lost"),
    answer("symptoms", ["energy"], "unknown"),
  ]) {
    assert.equal(candidate(run(context([], [fact])), "ferritin"), undefined);
  }
});

test("clear source-backed drafts remain clinician proposals with draft uncertainty", () => {
  const result = run(context([lowHb()]));
  assert.ok(candidate(result, "ferritin").allowedDecisions.includes("propose"));
  assert.ok(
    pattern(result, "iron-assessment").uncertainties.some((text) =>
      text.includes("draft"),
    ),
  );
});

test("uncertain values, inferred units, absent source and parsed/raw disagreement cannot trigger tests", () => {
  for (const change of [
    { issue: "uncertain reading" },
    { parsed: { value: 110, unit: "g/L", unitInferred: true } },
    { page: null },
    { parsed: { value: 111, unit: "g/L", unitInferred: false } },
    { asRecorded: { ...lowHb().asRecorded, sourceText: null } },
    { asRecorded: { ...lowHb().asRecorded, unit: null } },
  ]) {
    const result = run(context([{ ...lowHb(), ...change }]));
    assert.equal(candidate(result, "ferritin"), undefined);
    assert.equal(result.coverage[0].status, "limited");
  }
});

test("bounded results compare conservatively at inclusive and exclusive boundaries", () => {
  assert.equal(
    candidate(
      run(context([observation("haemoglobin", "≤120", "120-160")])),
      "ferritin",
    ),
    undefined,
  );
  assert.ok(
    candidate(
      run(context([observation("haemoglobin", "<120", "120-160")])),
      "ferritin",
    ),
  );
  assert.equal(
    candidate(
      run(context([observation("haemoglobin", "≤130", "120-160")])),
      "ferritin",
    ),
    undefined,
  );
});

test("HbA1c reliability connects matching red-cell findings and nominates glucose, without diagnosis", () => {
  const result = run(context([lowHb(), a1c()]));
  assert.ok(pattern(result, "hba1c-reliability"));
  assert.ok(candidate(result, "glucose").allowedDecisions.includes("propose"));
  assert.ok(
    pattern(result, "hba1c-reliability").uncertainties.some((text) =>
      text.includes("not calculated"),
    ),
  );
});

test("red-cell evidence from a different dated episode prompts chronology instead of asserting HbA1c interference", () => {
  const hb = lowHb();
  hb.asRecorded.date = "2025-09-20";
  const result = run(context([hb, a1c()]));
  assert.equal(pattern(result, "hba1c-reliability"), undefined);
  assert.equal(candidate(result, "glucose"), undefined);
  assert.ok(result.questions.some((item) => item.id === "hba1c-chronology"));
});

test("existing glucose with unknown fasting status holds duplicate ordering", () => {
  const result = run(
    context([lowHb(), a1c(), observation("glucose", 5.0, "3.9-5.6", "mmol/L")]),
  );
  assert.deepEqual(candidate(result, "glucose").allowedDecisions, ["defer"]);
  assert.match(candidate(result, "glucose").reason, /fasting status/);
});

test("a documented usable ferritin avoids a duplicate and has a calendar-based expiry", () => {
  const existing = observation("ferritin", 50, "15-150", "ng/mL");
  const result = run(context([lowHb(), existing]));
  assert.deepEqual(candidate(result, "ferritin").allowedDecisions, [
    "already_available",
    "defer",
  ]);
  assert.equal(result.nextRecomputeAt, "2027-03-20T00:00:00.000Z");
  const later = run(
    context([lowHb(), existing]),
    Date.parse("2027-03-21T00:00:00Z"),
  );
  assert.ok(candidate(later, "ferritin").allowedDecisions.includes("propose"));
});

test("month-end expiry clamps to a real calendar day", () => {
  const existing = observation("ferritin", 50, "15-150", "ng/mL");
  existing.asRecorded.date = "2026-08-31";
  assert.equal(
    run(context([lowHb(), existing])).nextRecomputeAt,
    "2027-02-28T00:00:00.000Z",
  );
});

test("issue dates and ambiguous dates never become specimen dates for reuse", () => {
  for (const patch of [
    { dateKind: "reported" },
    { dateKind: null },
    { date: "01/09/2026" },
    { date: "2026-02-30" },
  ]) {
    const ferritin = observation("ferritin", 50, "15-150", "ng/mL");
    Object.assign(ferritin.asRecorded, patch);
    assert.deepEqual(
      candidate(run(context([lowHb(), ferritin])), "ferritin").allowedDecisions,
      ["defer"],
    );
  }
});

test("unreviewed report coverage makes missing-test candidates defer-only", () => {
  const result = run(
    context([lowHb()], [], { reports: [{ id: "report:one" }] }),
  );
  assert.deepEqual(candidate(result, "ferritin").allowedDecisions, ["defer"]);
  assert.ok(
    result.limitations.some(
      (item) => item.code === "report_coverage_unverified",
    ),
  );
});

test("questionnaire-only cases preserve justified discussions but establish prior tests first", () => {
  const result = run(
    context([], [answer("symptoms", ["energy"])], { reports: [] }),
  );
  assert.deepEqual(candidate(result, "ferritin").allowedDecisions, ["defer"]);
  assert.ok(result.questions.some((item) => item.id === "prior-ferritin"));
});

test("once-only Lp(a) is available regardless of an old collection date and is never converted", () => {
  const lpa = observation("lipoprotein-a", 180, "0-75", "nmol/L");
  lpa.asRecorded.date = "2001-01-01";
  const result = run(context([lpa], [answer("family", ["heart"])]));
  assert.deepEqual(candidate(result, "lipoprotein-a").allowedDecisions, [
    "already_available",
    "defer",
  ]);
  assert.equal(lpa.asRecorded.unit, "nmol/L");
  assert.ok(result.questions.some((item) => item.id === "family-heart-detail"));
});

test("family history alone does not prove a premature event or trigger an ApoB panel", () => {
  const result = run(context([], [answer("family", ["heart"])]));
  assert.ok(candidate(result, "lipoprotein-a"));
  assert.equal(candidate(result, "apob"), undefined);
  assert.match(
    pattern(result, "lipid-risk-context").uncertainties[0],
    /does not establish/,
  );
});

test("known lipid/blood-sugar history supports selective ApoB without importing every legacy trigger", () => {
  assert.ok(
    candidate(run(context([], [answer("history", ["cholesterol"])])), "apob"),
  );
  assert.equal(
    candidate(run(context([], [answer("weight", "gained")])), "apob"),
    undefined,
  );
});

test("kidney pattern considers urine ACR without inferring chronic disease or creatine use", () => {
  const result = run(
    context([observation("creatinine", 125, "60-110", "µmol/L")]),
  );
  assert.ok(
    candidate(result, "urine-acr").allowedDecisions.includes("propose"),
  );
  assert.equal(candidate(result, "cystatin-c"), undefined);
  assert.ok(
    pattern(result, "kidney-context").uncertainties.some((text) =>
      text.includes("does not establish chronic"),
    ),
  );
});

test("liver pattern targets existing raised enzymes without adding infection tests or diagnosis", () => {
  const result = run(context([observation("alt", 65, "0-40", "U/L")]));
  assert.ok(candidate(result, "alt").allowedDecisions.includes("propose"));
  assert.equal(candidate(result, "hbsag"), undefined);
  assert.equal(candidate(result, "hepatitis-c-antibody"), undefined);
  assert.ok(result.questions.some((item) => item.id === "liver-context"));
});

test("thyroid rules add free T4 after outside-range TSH, and free T3 only with low TSH", () => {
  const high = run(context([observation("tsh", 6, "0.4-4", "mIU/L")]));
  assert.ok(candidate(high, "free-t4"));
  assert.equal(candidate(high, "free-t3"), undefined);
  const low = run(context([observation("tsh", 0.2, "0.4-4", "mIU/L")]));
  assert.ok(candidate(low, "free-t4"));
  assert.ok(candidate(low, "free-t3"));
  const normal = run(context([observation("tsh", 2, "0.4-4", "mIU/L")]));
  assert.equal(normal.candidates.length, 0);
});

test("macrocytosis supports B12/folate; an energy goal does not invent metformin use", () => {
  const result = run(context([observation("mcv", 104, "80-100", "fL")]));
  assert.ok(candidate(result, "vitamin-b12"));
  assert.ok(candidate(result, "folate"));
  const history = run(context([], [answer("history", ["blood-sugar"])]));
  assert.equal(candidate(history, "vitamin-b12"), undefined);
});

test("explicit lab critical flags remain visible even for unsupported markers and hold only proposals", () => {
  const alert = observation("unknown-marker", 99, null, "unknown");
  alert.asRecorded.flag = "CRITICAL";
  const result = run(context([alert, lowHb()]));
  assert.equal(result.coverage[0].status, "blocked");
  assert.equal(result.blockers[0].code, "lab_critical_flag");
  assert.equal(result.blockers[0].blocks, "test_proposals");
  assert.ok(
    result.patterns.some(
      (item) => item.requiredReview && item.observationIds.includes(alert.id),
    ),
  );
  assert.deepEqual(candidate(result, "ferritin").allowedDecisions, ["defer"]);
});

test("draft KB alert thresholds match printed units, and comparator bounds are conservative", () => {
  assert.ok(
    run(
      context([observation("glucose", 30, "3.9-5.6", "mmol/L")]),
    ).blockers.some((b) => b.code === "draft_kb_alert_band"),
  );
  assert.equal(
    run(context([observation("glucose", 30, "70-100", "mg/dL")])).blockers
      .length,
    1,
  ); // low glucose threshold, not an invented conversion
  assert.equal(
    run(context([observation("glucose", 100, "70-100", "unknown-unit")]))
      .blockers.length,
    0,
  );
  assert.equal(
    run(context([observation("glucose", "<30", "3.9-5.6", "mmol/L")])).blockers
      .length,
    0,
  );
  assert.ok(
    run(context([observation("glucose", ">30", "3.9-5.6", "mmol/L")])).blockers
      .length,
  );
});

test("relative alert bands require a printed upper limit and never use a model fallback", () => {
  assert.ok(
    run(context([observation("alt", 650, "0-40", "U/L")])).blockers.length,
  );
  assert.equal(
    run(context([observation("alt", 650, null, "U/L")])).blockers.length,
    0,
  );
});

test("same-date conflicting duplicate values do not silently choose one clinical trigger", () => {
  const a = lowHb(),
    b = observation("haemoglobin", 140, "120-160", "g/L", {
      id: "observation:hb-duplicate",
    });
  const result = run(context([a, b]));
  assert.equal(candidate(result, "ferritin"), undefined);
  assert.ok(
    result.limitations.some((item) => item.code === "ambiguous_latest_result"),
  );
});

test("old abnormal results do not override a newer dated in-range result", () => {
  const old = lowHb();
  old.asRecorded.date = "2025-01-01";
  const current = observation("haemoglobin", 140, "120-160", "g/L", {
    id: "observation:new-hb",
  });
  assert.equal(candidate(run(context([old, current])), "ferritin"), undefined);
});

test("future collection dates and unknown adult eligibility hold test proposals", () => {
  const future = lowHb();
  future.asRecorded.date = "2030-01-01";
  const result = run(context([future]));
  assert.ok(
    result.blockers.some((item) => item.code === "future_collection_date"),
  );
  assert.deepEqual(candidate(result, "ferritin").allowedDecisions, ["defer"]);
  assert.deepEqual(
    candidate(
      run(
        context([lowHb()], [], {
          questionnaire: { exactAge: null, facts: [] },
        }),
      ),
      "ferritin",
    ).allowedDecisions,
    ["defer"],
  );
});

test("pregnancy/treatment context holds automated test proposals without hiding observations", () => {
  const result = run(context([lowHb()], [answer("pregnancy", "yes")]));
  assert.deepEqual(candidate(result, "ferritin").allowedDecisions, ["defer"]);
  assert.equal(result.coverage.length, 1);
});

test("every emitted clinical claim/knowledge/evidence ID resolves and candidate IDs deduplicate", () => {
  const c = context(
    [
      lowHb(),
      a1c(),
      observation("mcv", 72, "80-100", "fL"),
      observation("tsh", 0.2, "0.4-4", "mIU/L"),
      observation("creatinine", 125, "60-110", "µmol/L"),
    ],
    [answer("symptoms", ["energy"]), answer("history", ["cholesterol"])],
  );
  const result = run(c),
    claims = new Set(knowledge.claims.map((item) => item.id));
  const records = new Set(knowledge.markers.map((item) => `marker:${item.id}`));
  const evidence = new Set(
    [...c.observations, ...c.questionnaire.facts].map((item) => item.id),
  );
  for (const item of [...result.patterns, ...result.candidates]) {
    for (const id of item.claimIds) assert.ok(claims.has(id), id);
    for (const id of item.evidenceIds) assert.ok(evidence.has(id), id);
    for (const id of item.knowledgeIds || [item.knowledgeId])
      assert.ok(records.has(id), id);
  }
  assert.equal(
    new Set(result.candidates.map((item) => item.id)).size,
    result.candidates.length,
  );
  for (const id of RULE_KNOWLEDGE_IDS) assert.ok(records.has(id));
});

test("invalid evaluation clocks are rejected instead of generating misleading recency", () => {
  assert.throws(
    () => evaluateCase(context(), { now: Number.NaN }),
    /valid evaluation time/,
  );
});

test("clinician-corrected current readings drive rules while immutable originals remain evidence", () => {
  const hb = lowHb();
  hb.current = {
    ...hb.asRecorded,
    value: "140",
    date: "2026-09-25",
    collectionDate: "2026-09-25",
  };
  hb.parsed.value = 140;
  hb.reviewStatus = "confirmed";
  const before = structuredClone(hb);
  const result = run(context([hb]));
  assert.equal(candidate(result, "ferritin"), undefined);
  assert.equal(result.coverage[0].status, "reviewed");
  assert.deepEqual(hb, before);
  assert.equal(hb.asRecorded.value, "110");
  const ferritin = observation("ferritin", 50, "15-150", "ng/mL");
  ferritin.asRecorded.dateKind = "report";
  ferritin.current = {
    ...ferritin.asRecorded,
    dateKind: "collection",
    collectionDate: "2026-09-25",
  };
  assert.equal(
    run(context([lowHb(), ferritin])).nextRecomputeAt,
    "2027-03-25T00:00:00.000Z",
  );
});

test("multiple laboratory alerts retain every row while sharing one mandatory summary", () => {
  const rows = Array.from({ length: 20 }, (_, index) => {
    const row = observation(`unsupported-${index}`, 99, null, "unknown", {
      id: `alert-${index}`,
    });
    row.asRecorded.flag = "CRITICAL";
    return row;
  });
  const result = run(context(rows));
  assert.equal(result.blockers.length, 20);
  assert.equal(
    result.coverage.filter((row) => row.status === "blocked").length,
    20,
  );
  assert.equal(result.patterns.filter((item) => item.requiredReview).length, 1);
  assert.equal(
    pattern(result, "verify-laboratory-alerts").observationIds.length,
    20,
  );
});
