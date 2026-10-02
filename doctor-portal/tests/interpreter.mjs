import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseContext } from "../lib/clinical/case-context.mjs";
import {
  assembleInterpretation,
  interpretCase,
  prepareInterpretation,
} from "../lib/clinical/interpreter.mjs";
import {
  createOpenAIProvider,
  encodeModelInput,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_TOKENS,
  reservationMicros,
  usageMicros,
} from "../lib/clinical/openai-provider.mjs";
import { report, submission } from "./fixtures/clinical-case.mjs";
import {
  config,
  memoryStore,
  offlineResponse,
} from "./fixtures/interpreter.mjs";

const now = Date.now();
const context = () =>
  buildCaseContext(structuredClone(submission), [structuredClone(report)], {
    now,
  });
const originals = () => [
  {
    reportId: report.report.id,
    filename: "report-1.pdf",
    mime: "application/pdf",
    pageCount: 1,
    sha256: "a".repeat(64),
    bytes: Buffer.from("fictional-provider-double"),
  },
];
const input = () => ({
  loadReportInputs: async () => originals(),
  caseContext: context(),
  submissionId: submission.id,
  inputSnapshot: {
    questionnaireVersion: submission.questionnaire_version,
    answers: submission.answers,
    notes: submission.notes,
    reports: [
      {
        reportId: report.report.id,
        extractionId: report.extraction.id,
        reviewRevision: 0,
      },
    ],
  },
  expiresAt: new Date(now + 7 * 86400000).toISOString(),
});
const completed = (output) => ({
  output,
  status: "completed",
  usage: {
    input_tokens: 12000,
    output_tokens: 6000,
    input_tokens_details: { cached_tokens: 0 },
  },
  model: config.model,
  responseId: "offline-double",
});

test("complete offline pipeline persists provenance, charges actual usage, and reuses cache without another call", async () => {
  const store = memoryStore();
  let calls = 0;
  const provider = {
    config,
    estimate: async () => 1_000_000,
    async verify() {
      return completed({ supported: true, issues: [] });
    },
    async synthesize(encoded) {
      calls++;
      const data = JSON.parse(encoded);
      return completed(offlineResponse({ context: data }));
    },
  };
  const result = await interpretCase(input(), { store, provider, now });
  assert.equal(result.source, "openai"); // transport label, not a real API call
  assert.equal(
    result.clinicalStatus,
    "draft_ai_interpretation_not_clinically_validated",
  );
  assert.equal(result.coverage.length, 1);
  assert.equal(result.plan.tests.length, 0); // unclear specimen date cannot silently trigger repeat
  assert.equal(store.runs.length, 1);
  assert.equal([...store.reservations.values()][0].actualMicros, 84000);
  assert.ok(store.runs[0].analysis.grounding.findings.length);
  assert.equal(store.runs[0].metadata.actualModel, config.model);
  const again = await interpretCase(input(), { store, provider, now });
  assert.equal(calls, 1);
  assert.equal(again.cached, true);
  assert.equal(result.runId, again.runId);
});
test("evidence contract rejects missing review findings, invented identifiers and numbers as an entire draft", () => {
  const prepared = prepareInterpretation(context(), { now });
  const valid = offlineResponse(prepared);
  assert.ok(assembleInterpretation(valid, prepared));
  for (const change of [
    (raw) => {
      raw.caseFingerprint = "a".repeat(64);
    },
    (raw) => {
      raw.findings = [];
    },
    (raw) => {
      raw.findings[0].evidenceIds = ["observation:imagined-result"];
    },
    (raw) => {
      raw.findings.push(raw.findings[0]);
    },
    (raw) => {
      raw.observationCoverage = [];
    },
    (raw) => {
      raw.actionLedger[0].knowledgeId = "marker:invented-test";
    },
    (raw) => {
      raw.summaryLong = "Ferritin is 99 and should be repeated.";
    },
    (raw) => {
      raw.questions = [
        { text: "Order a scan.", evidenceIds: ["invented-fact"] },
      ];
    },
    (raw) => {
      raw.extra = "injection";
    },
  ]) {
    const raw = structuredClone(valid);
    change(raw);
    assert.throws(() => assembleInterpretation(raw, prepared), {
      code: "invalid_analysis",
    });
  }
});
test("timeouts retain a full reservation; invalid and incomplete responses still account for billed usage", async () => {
  const store = memoryStore();
  await assert.rejects(() =>
    interpretCase(input(), {
      store,
      now,
      provider: {
        config,
        estimate: async () => 1_000_000,
        async verify() {
          return completed({ supported: true, issues: [] });
        },
        async synthesize() {
          throw new Error("timeout");
        },
      },
    }),
  );
  assert.equal(store.runs.length, 0);
  assert.equal([...store.reservations.values()][0].actualMicros, undefined);
  for (const response of [
    completed({ invented: true }),
    { ...completed(null), status: "incomplete" },
  ]) {
    const ledger = memoryStore();
    await assert.rejects(() =>
      interpretCase(input(), {
        store: ledger,
        now,
        provider: {
          config,
          estimate: async () => 1_000_000,
          async verify() {
            return completed({ supported: true, issues: [] });
          },
          async synthesize() {
            return response;
          },
        },
      }),
    );
    assert.equal(ledger.runs.length, 0);
    assert.equal([...ledger.reservations.values()][0].actualMicros, 84000);
  }
});
test("budget denial happens before the provider and missing credentials never return a sample analysis", async () => {
  let calls = 0;
  const store = memoryStore();
  store.reserve = async () => {
    throw Object.assign(new Error(), { code: "budget_exhausted" });
  };
  await assert.rejects(
    () =>
      interpretCase(input(), {
        store,
        now,
        provider: {
          config,
          estimate: async () => 1_000_000,
          async verify() {
            return completed({ supported: true, issues: [] });
          },
          async synthesize() {
            calls++;
          },
        },
      }),
    { code: "budget_exhausted" },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => interpretCase(input(), { store: memoryStore(), env: {}, now }),
    { code: "analysis_not_connected" },
  );
});
test("cache identity changes with corrected evidence, model and rule dispositions but not assembly timestamp", () => {
  const a = prepareInterpretation(context(), { now });
  const b = prepareInterpretation(context(), { now: now + 1000 });
  assert.equal(a.cacheKey, b.cacheKey);
  assert.notEqual(
    a.cacheKey,
    prepareInterpretation(context(), { now, model: "gpt-6-astra" }).cacheKey,
  );
  const changed = context();
  changed.observations[0].current.value = "42";
  changed.observations[0].parsed.value = 42;
  changed.caseFingerprint = "b".repeat(64);
  assert.notEqual(a.cacheKey, prepareInterpretation(changed, { now }).cacheKey);
});
test("synthesis prompt includes full pages and KB while excluding direct contact fields", () => {
  const prepared = prepareInterpretation(context(), { now });
  const encoded = encodeModelInput(prepared.context, prepared.evaluation);
  assert.doesNotMatch(encoded, /fixture@example|Do not send this field/);
  assert.match(encoded, /Fictional report\./);
  assert.equal(JSON.parse(encoded).knowledge.markers.length, 81);
  assert.equal(JSON.parse(encoded).evaluation, undefined);
  assert.ok(reservationMicros(encoded, config) > 60000);
  assert.equal(
    usageMicros(
      {
        input_tokens: 12000,
        output_tokens: 6000,
        input_tokens_details: { cached_tokens: 1000 },
      },
      config,
    ),
    82100,
  );
  assert.equal(usageMicros({}, config), null);
  const huge = structuredClone(prepared.context);
  huge.questionnaire.facts.push({ text: "x".repeat(MAX_INPUT_BYTES) });
  assert.throws(() => encodeModelInput(huge, prepared.evaluation), {
    code: "analysis_too_large",
  });
});
test("OpenAI adapter uses Responses structured output, store false, bounded output and a server-only key", async () => {
  let sent;
  const provider = createOpenAIProvider(
    {
      NAMAT_ANALYSIS_ENABLED: "true",
      OPENAI_API_KEY: "test-only-never-network",
    },
    {
      responses: {
        async create(body) {
          sent = body;
          return {
            status: "completed",
            output_text: "{}",
            usage: {},
            model: config.model,
            id: "fake",
          };
        },
      },
    },
  );
  await provider.synthesize("untrusted fictional case");
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.model, config.model);
  assert.equal(sent.max_output_tokens, MAX_OUTPUT_TOKENS);
  assert.equal(sent.tools, undefined);
  assert.match(sent.instructions, /UNTRUSTED DATA/);
  assert.doesNotMatch(JSON.stringify(sent), /test-only-never-network/);
});

test("a case changed between cache lookup and read is rejected without model access", async () => {
  const store = memoryStore();
  store.findRun = async () => ({ id: "stale-run" });
  store.getRun = async () => null;
  let called = false;
  await assert.rejects(
    () =>
      interpretCase(input(), {
        store,
        now,
        provider: {
          config,
          async synthesize() {
            called = true;
          },
        },
      }),
    { code: "stale_analysis" },
  );
  assert.equal(called, false);
});

test("one grounded correction is reverified and every paid attempt is retained", async () => {
  const store = memoryStore();
  let generations = 0,
    checks = 0;
  const issues = [
    {
      scope: "action",
      index: 0,
      reason: "Fictional feedback: remove the unsupported test.",
    },
  ];
  const provider = {
    config,
    estimate: async () => 1000000,
    async synthesize(encoded) {
      const data = JSON.parse(encoded);
      generations++;
      const output = offlineResponse({ context: data });
      if (generations === 2) {
        assert.deepEqual(data.revision.issues, issues);
        assert.ok(data.revision.previousDraft.actionLedger.length);
        output.actionLedger = [];
      }
      return completed(output);
    },
    async verify(encoded) {
      checks++;
      if (checks === 2)
        assert.deepEqual(JSON.parse(encoded).draft.actionLedger, []);
      return completed(
        checks === 1
          ? { supported: false, issues }
          : { supported: true, issues: [] },
      );
    },
  };
  const saved = await interpretCase(input(), { store, provider, now });
  assert.equal(saved.actionLedger.length, 0);
  assert.equal(generations, 2);
  assert.equal(checks, 2);
  assert.equal(store.reservations.size, 4);
  assert.equal(store.runs[0].metadata.attempts.length, 2);
  assert.ok(
    [...store.reservations.values()].every((row) => row.actualMicros === 84000),
  );
});

test("insufficient correction budget stops before another call and never saves a rejected draft", async () => {
  const store = memoryStore(),
    reserve = store.reserve;
  let generations = 0;
  store.reserve = async (value) => {
    if (store.reservations.size === 2)
      throw Object.assign(new Error(), { code: "budget_exhausted" });
    return reserve(value);
  };
  await assert.rejects(
    () =>
      interpretCase(input(), {
        store,
        now,
        provider: {
          config,
          estimate: async () => 1000000,
          async synthesize(encoded) {
            generations++;
            return completed(offlineResponse({ context: JSON.parse(encoded) }));
          },
          async verify() {
            return completed({
              supported: false,
              issues: [
                { scope: "action", index: 0, reason: "Unsupported proposal." },
              ],
            });
          },
        },
      }),
    { code: "budget_exhausted" },
  );
  assert.equal(generations, 1);
  assert.equal(store.reservations.size, 2);
  assert.equal(store.runs.length, 0);
});
