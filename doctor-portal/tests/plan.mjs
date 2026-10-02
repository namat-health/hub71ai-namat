import assert from "node:assert/strict";
import test from "node:test";
import { validatePlan } from "../lib/plan.mjs";
import { generatePlan } from "../lib/plan-preview-fixture.mjs";

test("the placeholder generator returns a plan in the published contract", async () => {
  const { plan, source } = await generatePlan({ questionnaire: {}, labs: [] });
  assert.equal(source, "placeholder");
  assert.deepEqual(validatePlan(plan), plan);
  assert.deepEqual(Object.keys(plan), [
    "summaryShort",
    "summaryLong",
    "findings",
    "tests",
    "followUps",
    "sources",
  ]);
  assert.deepEqual(
    plan.tests.filter((item) => item.group === "now").map((item) => item.id),
    ["iron-studies", "b12-folate", "thyroid-panel", "apob-lpa", "dexa"],
  );
  assert.ok(
    plan.findings.every((item) => ["act", "monitor"].includes(item.severity)),
  );
  // Each call returns a fresh copy that callers may change.
  plan.findings.length = 0;
  assert.equal((await generatePlan({})).plan.findings.length, 5);
});

test("validation keeps contract fields only and rejects malformed plans", async () => {
  const { plan } = await generatePlan({});
  const extra = structuredClone(plan);
  extra.model = "SECRET";
  extra.findings[0].internalScore = 0.9;
  extra.findings[0].evidence[0].weight = 1;
  const clean = validatePlan(extra);
  assert.equal(clean.model, undefined);
  assert.equal(clean.findings[0].internalScore, undefined);
  assert.deepEqual(clean.findings[0].evidence[0], {
    type: "lab",
    labId: "ferritin",
  });

  const broken = [
    (value) => {
      delete value.summaryShort;
    },
    (value) => {
      value.findings[0].severity = "urgent";
    },
    (value) => {
      value.findings[0].evidence.push({
        type: "web",
        url: "https://example.invalid",
      });
    },
    (value) => {
      value.findings[0].evidence[0].labId = "Ferritin!";
    },
    (value) => {
      value.tests[1].id = value.tests[0].id;
    },
    (value) => {
      value.tests[0].group = "later";
    },
    (value) => {
      value.tests[0].locationType = "pharmacy";
    },
    (value) => {
      value.summaryShort = "x".repeat(241);
    },
    (value) => {
      value.followUps = "soon";
    },
    (value) => {
      value.sources = -1;
    },
    (value) => {
      value.findings = Array.from({ length: 17 }, () => value.findings[0]);
    },
  ];
  for (const change of broken) {
    const value = structuredClone(plan);
    change(value);
    assert.equal(validatePlan(value), null);
  }
  for (const value of [null, [], "plan", 1])
    assert.equal(validatePlan(value), null);
});

test("optional text may be empty but required text may not", async () => {
  const { plan } = await generatePlan({});
  const value = structuredClone(plan);
  value.tests[0].prep = "";
  value.tests[0].includes = undefined;
  value.findings[0].keyValues = "";
  const clean = validatePlan(value);
  assert.equal(clean.tests[0].prep, "");
  assert.equal(clean.tests[0].includes, "");
  value.tests[0].name = "  ";
  assert.equal(validatePlan(value), null);
});
