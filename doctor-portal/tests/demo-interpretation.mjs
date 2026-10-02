import assert from "node:assert/strict";
import test from "node:test";
import { assessmentRequest } from "../lib/assessment-request.mjs";
import {
  demoInput,
  expandDemoOutput,
} from "../lib/clinical/demo-interpretation.mjs";
import {
  interpretCase,
  prepareInterpretation,
} from "../lib/clinical/interpreter.mjs";
import { assertNarrativeBoundaries } from "../lib/clinical/narrative-check.mjs";
import { modelConfig } from "../lib/clinical/openai-provider.mjs";
import { evaluationCase } from "../scripts/clinical-evaluation/cases.mjs";
import { memoryStore, offlineResponse } from "./fixtures/interpreter.mjs";

function fixture(name = "iron_glycemia") {
  const now = Date.now(),
    c = evaluationCase(name, now);
  const config = modelConfig({
    NAMAT_ANALYSIS_MODE: "demo",
    NAMAT_ANALYSIS_MODEL: "gpt-6-luna",
  });
  const prepared = prepareInterpretation(c.input.caseContext, {
    now,
    model: config.model,
    mode: config.mode,
  });
  const { input, ids } = demoInput(
    prepared.context,
    prepared.evaluation,
    c.originals,
  );
  const short = (id) => ids.get(id) || id,
    refs = (xs) => xs.map(short);
  const raw = offlineResponse(prepared);
  delete raw.caseFingerprint;
  delete raw.summaryLong;
  delete raw.observationCoverage;
  raw.findings = raw.findings.map(({ reasonLong, ...f }) => ({
    ...f,
    evidenceIds: refs(f.evidenceIds),
    contraryEvidenceIds: refs(f.contraryEvidenceIds),
    claimIds: refs(f.claimIds),
  }));
  raw.actionLedger = raw.actionLedger.map((a) => ({
    ...a,
    knowledgeId: short(a.knowledgeId),
    evidenceIds: refs(a.evidenceIds),
    claimIds: refs(a.claimIds),
  }));
  raw.reportCoverage = raw.reportCoverage.map((r) => ({
    ...r,
    reportId: short(r.reportId),
  }));
  return { c, config, prepared, input, ids, raw, now };
}

test("demo performs one paid pass, preserves original inputs and accurately labels skipped semantic verification", async () => {
  const f = fixture(),
    store = memoryStore();
  let calls = 0;
  const provider = {
    config: f.config,
    estimate: async () => 10000,
    synthesize: async (input, originals) => {
      calls++;
      assert.equal(originals.length, 1);
      assert.ok(input.length < 40000);
      return {
        output: f.raw,
        status: "completed",
        usage: { input_tokens: 3000, output_tokens: 700 },
        model: f.config.model,
        responseId: "fictional-demo",
        durationMs: 4200,
      };
    },
    verify: () => {
      throw Error("Demo must not call verifier");
    },
  };
  const result = await interpretCase(f.c.input, {
    store,
    provider,
    now: f.now,
  });
  assert.equal(result.demo, true);
  assert.equal(result.validation.referenceChecks, "passed");
  assert.equal(result.validation.narrativeCheck, "not_run_demo");
  assert.equal(result.timings.interpretationMs, 4200);
  assert.equal(calls, 1);
  assert.equal(store.runs[0].metadata.verification.status, "not_run_demo");
  const reopened = await interpretCase(f.c.input, {
    store,
    provider,
    now: f.now + 1,
  });
  assert.equal(reopened.cached, true);
  assert.equal(calls, 1);
  assert.notEqual(
    f.prepared.cacheKey,
    prepareInterpretation(f.c.input.caseContext, {
      now: f.now,
      model: f.config.model,
    }).cacheKey,
  );
});

test("demo cannot invent IDs or cite knowledge omitted from its input", () => {
  const f = fixture();
  f.raw.findings[0].claimIds = ["marker:psa:evidence_note"];
  assert.throws(() => expandDemoOutput(f.raw, f.prepared, f.ids), {
    code: "invalid_analysis",
  });
});

test("unmentioned observations are explicitly unassessed, never silently marked normal", () => {
  const f = fixture();
  f.raw.findings = [];
  f.raw.actionLedger = [];
  const expanded = expandDemoOutput(f.raw, f.prepared, f.ids);
  assert.ok(expanded.observationCoverage.length > 0);
  assert.ok(
    expanded.observationCoverage.every((r) => r.disposition === "uncertain"),
  );
});

test("demo still rejects omission of a critical finding and accounts for paid usage", async () => {
  const f = fixture("critical_potassium"),
    store = memoryStore();
  f.raw.findings = [];
  f.raw.actionLedger = [];
  await assert.rejects(
    () =>
      interpretCase(f.c.input, {
        store,
        now: f.now,
        provider: {
          config: f.config,
          estimate: async () => 10000,
          synthesize: async () => ({
            output: f.raw,
            status: "completed",
            usage: { input_tokens: 1000, output_tokens: 200 },
          }),
        },
      }),
    { code: "invalid_analysis" },
  );
  assert.equal(store.runs.length, 0);
  assert.equal([...store.reservations.values()][0].actualMicros, 400);
});

test("stalled fetch and stalled response body both leave the loading state through a bounded error", async () => {
  for (const body of [false, true]) {
    let signal;
    await assert.rejects(
      () =>
        assessmentRequest("/fictional", {}, 10, async (_, options) => {
          signal = options.signal;
          return body
            ? { json: () => new Promise(() => {}) }
            : new Promise(() => {});
        }),
      /too long/,
    );
    assert.equal(signal.aborted, true);
  }
});

test("cancelling an assessment aborts it without waiting for the deadline", async () => {
  const controller = new AbortController();
  const pending = assessmentRequest(
    "/fictional",
    { signal: controller.signal },
    1000,
    () => new Promise(() => {}),
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("a question about possible blood loss is not an assertion of blood loss", () => {
  const context = fixture().c.input.caseContext;
  assert.doesNotThrow(() =>
    assertNarrativeBoundaries(
      {
        summaryShort: "Are there relevant factors such as recent blood loss?",
        summaryLong: "Draft.",
      },
      context,
    ),
  );
  assert.throws(
    () =>
      assertNarrativeBoundaries(
        {
          summaryShort: "Given recent blood loss, is follow-up needed?",
          summaryLong: "Draft.",
        },
        context,
      ),
    { code: "invalid_analysis" },
  );
});
