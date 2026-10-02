import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  decisionResponse,
  inventoryResponse,
  patientEmailResponse,
  planResponse,
  savedPlanResponse,
} from "../lib/portal-backend.mjs";
import {
  SHARED_API_ORIGIN,
  sharedAnalysisStore,
  sharedReportEvidence,
} from "../lib/shared-api.mjs";
import { report, submission } from "./fixtures/clinical-case.mjs";
import {
  config,
  memoryStore,
  offlineResponse,
} from "./fixtures/interpreter.mjs";

const owner = "11111111-1111-4111-8111-111111111111",
  tenant = "33333333-3333-4333-8333-333333333333";
const hostname = "doctor-test.azurewebsites.net",
  key = "fixture-only-service-key-0123456789abcdef";
const env = {
  NAMAT_SHARED_API_ENABLED: "true",
  NAMAT_SHARED_API_ORIGIN: SHARED_API_ORIGIN,
  NAMAT_SHARED_API_PORTAL_TOKEN: key,
  NAMAT_PORTAL_AUTH_MODE: "azure-easy-auth",
  NAMAT_PORTAL_TENANT_ID: tenant,
  NAMAT_PORTAL_ALLOWED_USER_IDS: owner,
  WEBSITE_SITE_NAME: "doctor-test",
  WEBSITE_HOSTNAME: hostname,
  WEBSITE_INSTANCE_ID: "fictional-instance-id",
};
const params = { submissionId: submission.id },
  reference = { ...params, reportId: report.report.id };
const evidencePath = `/v1/demo/submissions/${submission.id}/reports/${report.report.id}/evidence-v1`;
const sourcePath = `/v1/demo/submissions/${submission.id}/reports/${report.report.id}`;
// Transport fixture only: the authored provider does not read this tiny image.
const originalBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4cAAAAASUVORK5CYII=",
  "base64",
);
const originalHash = createHash("sha256").update(originalBytes).digest("hex");
function request({
  method = "POST",
  body,
  origin = `https://${hostname}`,
  user = owner,
} = {}) {
  return new Request(`https://${hostname}/api`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      ...(user
        ? {
            "X-MS-CLIENT-PRINCIPAL": Buffer.from(
              JSON.stringify({
                auth_typ: "aad",
                claims: [
                  { typ: "oid", val: user },
                  { typ: "tid", val: tenant },
                  { typ: "name", val: "Dr Fictional" },
                ],
              }),
            ).toString("base64"),
          }
        : {}),
    },
  });
}
const failure = (code) => Object.assign(new Error(code), { code });
function harness() {
  const now = Date.now(),
    store = memoryStore(),
    inventory = [],
    fetches = [],
    providerCalls = [],
    verificationCalls = [];
  const data = structuredClone(report);
  data.evidenceVersion = "namat-report-evidence-v1";
  data.extraction.inputSha256 = originalHash;
  data.extraction.pages[0].lines = [
    {
      id: "page:1:line:0",
      text: data.extraction.observations[0].sourceText,
      bounds: null,
    },
  ];
  for (const observation of data.extraction.observations)
    Object.assign(observation, {
      dateKind: "unknown",
      dateSourceText: null,
      dateSourcePage: null,
    });
  const patient = {
    ...structuredClone(submission),
    receipt_id: "44444444-4444-4444-8444-444444444444",
    data_class: "synthetic",
    fictional_confirmed: true,
    expires_at: new Date(now + 7 * 86400000).toISOString(),
    attached_reports: submission.attached_reports.map((item) => ({
      ...item,
      name: "fictional.png",
      mime: "image/png",
      size: originalBytes.length,
      sourceUrl: `/api/submissions/${submission.id}/reports/${item.id}/source`,
    })),
  };
  const state = {
    now,
    data,
    patient,
    inventory,
    providerOutput: null,
    providerStatus: "completed",
    verificationOutput: { supported: true, issues: [] },
  };
  const find = store.findRun.bind(store),
    get = store.getRun.bind(store);
  store.findRun = (input) =>
    find({ ...input, now: input.now || new Date(state.now).toISOString() });
  store.getRun = async (input) => {
    const run = await get(input);
    return run && Date.parse(run.expiresAt) > state.now ? run : null;
  };
  store.getInventoryReviews = async ({ submissionId }) =>
    inventory.filter(
      (item) =>
        item.submissionId === submissionId &&
        item.extractionId === state.data.extraction.id &&
        item.reviewRevision === state.data.reviewRevision,
    );
  store.saveInventoryReview = async (input) => {
    if (input.submissionId !== patient.id || input.reportId !== data.report.id)
      throw failure("not_found");
    if (
      input.extractionId !== state.data.extraction.id ||
      input.reviewRevision !== state.data.reviewRevision
    )
      throw failure("conflict");
    const value = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(state.now).toISOString(),
    };
    inventory.push(value);
    return value;
  };
  const options = {
    env: { ...env },
    now,
    provider: {
      config,
      async estimate(_encoded, originals) {
        assert.equal(originals.length, 1);
        assert.deepEqual(originals[0].bytes, originalBytes);
        assert.equal(originals[0].sha256, originalHash);
        return 1_000_000;
      },
      async synthesize(encoded, originals) {
        assert.equal(originals.length, 1);
        assert.equal(originals[0].filename, "report-1.png");
        providerCalls.push(encoded);
        const input = JSON.parse(encoded);
        const output = state.providerOutput
          ? state.providerOutput(input)
          : offlineResponse({ context: input });
        return {
          output,
          status: state.providerStatus,
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            input_tokens_details: { cached_tokens: 0 },
          },
          model: config.model,
          responseId: "offline-only",
        };
      },
      async verify(encoded, originals) {
        assert.deepEqual(originals[0].bytes, originalBytes);
        verificationCalls.push(encoded);
        return {
          status: "completed",
          output: state.verificationOutput,
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            input_tokens_details: { cached_tokens: 0 },
          },
          model: config.model,
          responseId: "offline-verification",
        };
      },
    },
    getPool() {
      throw new Error("No direct database fallback");
    },
    async fetchImpl(url, init) {
      fetches.push({ url, init });
      const path = url.slice(SHARED_API_ORIGIN.length);
      if (path === "/v1/demo/submissions")
        return Response.json({ submissions: [state.patient] });
      if (path === evidencePath) return Response.json(state.data);
      if (path === sourcePath) {
        assert.equal(init.headers["X-Namat-Service-Key"], key);
        assert.equal(init.redirect, "error");
        assert.equal(init.credentials, "omit");
        return new Response(originalBytes, {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(originalBytes.length),
            "X-Namat-Content-Sha256": originalHash,
          },
        });
      }
      if (path === "/v1/demo/analysis-store") {
        const { operation, input } = JSON.parse(init.body);
        try {
          return Response.json({
            result: (await store[operation](input)) ?? null,
          });
        } catch (error) {
          return Response.json(
            { error: error.code },
            {
              status:
                error.code === "not_found"
                  ? 404
                  : error.code === "conflict"
                    ? 409
                    : 503,
            },
          );
        }
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  };
  return { options, state, store, fetches, providerCalls, verificationCalls };
}
async function generated(h) {
  const response = await planResponse(request(), params, h.options),
    body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
const decisionBody = (run) => ({
  runId: run.runId,
  caseFingerprint: run.caseFingerprint,
  decision: "approved",
  selectedTestIds: [],
  notes: "Reviewed against source",
});

test("analysis routes reject missing identity and foreign origins before any data or model access", async () => {
  for (const handler of [
    planResponse,
    savedPlanResponse,
    decisionResponse,
    inventoryResponse,
  ]) {
    for (const [requestOptions, status] of [
      [{ user: null }, 401],
      [{ origin: "https://foreign.invalid" }, 403],
      [{ origin: null }, 403],
    ]) {
      const h = harness();
      const response = await handler(
        request(requestOptions),
        params,
        h.options,
      );
      assert.equal(response.status, status);
      assert.equal(h.fetches.length, 0);
      assert.equal(h.providerCalls.length, 0);
    }
  }
});
test("an unconnected account produces no reservation or placeholder plan", async () => {
  const h = harness();
  delete h.options.provider;
  const response = await planResponse(request(), params, h.options),
    body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "analysis_not_connected");
  assert.equal(h.store.reservations.size, 0);
  assert.equal(h.store.runs.length, 0);
  assert.equal(h.providerCalls.length, 0);
});
test("unread reports and unconfirmed unit ambiguities stop before inference", async () => {
  for (const alter of [
    (h) => {
      h.state.data.report.status = "processing";
    },
    (h) => {
      h.state.data.extraction.observations[0].unit = null;
    },
  ]) {
    const h = harness();
    alter(h);
    const response = await planResponse(request(), params, h.options);
    assert.equal(response.status, 409);
    assert.equal(h.providerCalls.length, 0);
    assert.equal(h.store.reservations.size, 0);
  }
});
test("real rules and assembly save the offline provider result and reload it without another model call", async () => {
  const h = harness(),
    run = await generated(h);
  assert.equal(h.store.runs.length, 1);
  assert.equal(h.providerCalls.length, 1);
  assert.ok(run.grounding.findings.length);
  assert.ok(run.evidence.observations.length);
  assert.equal(run.cached, false);
  const response = await savedPlanResponse(
      request({ method: "GET" }),
      params,
      h.options,
    ),
    body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.analysis.runId, run.runId);
  assert.equal(body.analysis.cached, true);
  const again = await generated(h);
  assert.equal(again.runId, run.runId);
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.verificationCalls.length, 1);
  assert.equal(h.store.reservations.size, 2);
  assert.ok(h.fetches.some((item) => item.url.endsWith("/analysis-store")));
  assert.doesNotMatch(
    h.providerCalls[0],
    /fixture@example|Do not send this field/,
  );
});
test("failed narrative verification settles its usage but never stores the draft", async () => {
  const h = harness();
  h.state.verificationOutput = {
    supported: false,
    issues: ["Unsupported statement"],
  };
  const response = await planResponse(request(), params, h.options);
  assert.equal(response.status, 502);
  assert.equal(h.store.runs.length, 0);
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.verificationCalls.length, 1);
  assert.equal(h.store.reservations.size, 2);
  assert.ok(
    [...h.store.reservations.values()].every(
      (item) => item.actualMicros === 7000,
    ),
  );
});
test("doctor decisions persist on reload, reject arbitrary test injection and ignore a browser-supplied actor", async () => {
  const h = harness(),
    run = await generated(h);
  let response = await decisionResponse(
    request({
      body: { ...decisionBody(run), selectedTestIds: ["invented-test"] },
    }),
    params,
    h.options,
  );
  assert.equal(response.status, 400);
  assert.equal(h.store.decisions.length, 0);
  response = await decisionResponse(
    request({ body: { ...decisionBody(run), actor: "Spoofed doctor" } }),
    params,
    h.options,
  );
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  assert.equal(h.store.decisions[0].actor, `Dr Fictional (microsoft:${owner})`);
  const reload = await (
    await savedPlanResponse(request({ method: "GET" }), params, h.options)
  ).json();
  assert.equal(reload.analysis.latestDecision.decision, "approved");
  assert.equal(reload.analysis.latestDecision.notes, "Reviewed against source");
});
test("changing report revision or model invalidates saved drafts and refuses old approval", async () => {
  for (const change of [
    (h) => {
      h.state.data.reviewRevision = 1;
    },
    (h) => {
      h.options.env.NAMAT_ANALYSIS_MODEL = "gpt-6-astra";
    },
  ]) {
    const h = harness(),
      run = await generated(h);
    change(h);
    const saved = await (
      await savedPlanResponse(request({ method: "GET" }), params, h.options)
    ).json();
    assert.equal(saved.analysis, null);
    const response = await decisionResponse(
      request({ body: decisionBody(run) }),
      params,
      h.options,
    );
    assert.equal(response.status, 409);
    assert.equal(h.store.decisions.length, 0);
    assert.equal(h.providerCalls.length, 1);
  }
});
test("expired analysis cannot be reloaded or approved", async () => {
  const h = harness(),
    run = await generated(h);
  h.state.now += 25 * 3600000;
  h.options.now = h.state.now;
  const saved = await (
    await savedPlanResponse(request({ method: "GET" }), params, h.options)
  ).json();
  assert.equal(saved.analysis, null);
  const response = await decisionResponse(
    request({ body: decisionBody(run) }),
    params,
    h.options,
  );
  assert.equal(response.status, 409);
  assert.equal(h.store.decisions.length, 0);
});
test("incomplete/refused output and invented model actions never save a personalised draft", async () => {
  for (const alteration of [
    (h) => {
      h.state.providerOutput = () => null;
    },
    (h) => {
      h.state.providerStatus = "incomplete";
    },
    (h) => {
      h.state.providerOutput = (input) => {
        const output = offlineResponse({ context: input });
        output.actionLedger.push({
          knowledgeId: "marker:invented-test",
          intent: "new",
          decision: "propose",
          findingIds: [],
          evidenceIds: [input.questionnaire.facts[0].id],
          claimIds: [input.knowledge.claims[0].id],
          reason: "Injected action",
        });
        return output;
      };
    },
  ]) {
    const h = harness();
    alteration(h);
    const response = await planResponse(request(), params, h.options);
    assert.equal(response.status, 502);
    assert.equal(h.store.runs.length, 0);
    assert.equal(h.providerCalls.length, 1);
    assert.equal([...h.store.reservations.values()][0].actualMicros, 7000);
  }
});
test("inventory confirmation is bound to the report/extraction/review and identity comes from Microsoft", async () => {
  const h = harness(),
    body = {
      reportId: report.report.id,
      extractionId: report.extraction.id,
      reviewRevision: 0,
      confirmed: true,
      actor: "Injected",
    };
  let response = await inventoryResponse(
    request({ body: { ...body, reviewRevision: 1 } }),
    params,
    h.options,
  );
  assert.equal(response.status, 409);
  assert.equal(h.state.inventory.length, 0);
  response = await inventoryResponse(request({ body }), params, h.options);
  assert.equal(response.status, 200);
  assert.equal(h.state.inventory[0].actor, `Dr Fictional (microsoft:${owner})`);
  const read = await (
    await inventoryResponse(request({ method: "GET" }), params, h.options)
  ).json();
  assert.equal(read.reviews.length, 1);
  const old = await generated(h);
  h.state.data.reviewRevision = 1;
  const responseAfterChange = await decisionResponse(
    request({ body: decisionBody(old) }),
    params,
    h.options,
  );
  assert.equal(responseAfterChange.status, 409);
  const latest = await (
    await inventoryResponse(request({ method: "GET" }), params, h.options)
  ).json();
  assert.deepEqual(latest.reviews, []);
});
test("shared evidence preserves full text/date provenance and rejects mismatched report and unsupported version", async () => {
  const h = harness(),
    data = await sharedReportEvidence(reference, h.options);
  assert.equal(
    data.extraction.pages[0].lines[0].text,
    report.extraction.observations[0].sourceText,
  );
  assert.equal(data.extraction.observations[0].dateKind, "unknown");
  for (const alter of [
    (data) => (data.report.id = randomUUID()),
    (data) => (data.evidenceVersion = "future-version"),
    (data) => (data.report.pageCount = 2),
    (data) => (data.extraction.pages[0].lines[0].id = "page:2:line:0"),
    (data) =>
      data.extraction.pages[0].lines.push(data.extraction.pages[0].lines[0]),
    (data) => (data.extraction.observations[0].page = 2),
  ]) {
    const invalid = harness();
    alter(invalid.state.data);
    await assert.rejects(
      () => sharedReportEvidence(reference, invalid.options),
      { code: "unavailable" },
    );
  }
  const larger = harness();
  larger.state.data.extraction.pages[0].text = "x".repeat(500001);
  larger.state.data.extraction.pages[0].lines[0].text = "x".repeat(50001);
  assert.equal(
    (await sharedReportEvidence(reference, larger.options)).extraction.pages[0]
      .text.length,
    500001,
  );
});
test("shared storage sends bounded authenticated operations without credentials in results and preserves conflicts", async () => {
  let sent;
  const store = sharedAnalysisStore({
    env,
    fetchImpl: async (url, init) => {
      sent = { url, init };
      return Response.json({ result: { revision: 1 } });
    },
  });
  assert.deepEqual(await store.getInventoryReviews(params), { revision: 1 });
  assert.equal(sent.url, `${SHARED_API_ORIGIN}/v1/demo/analysis-store`);
  assert.equal(sent.init.method, "POST");
  assert.equal(sent.init.headers["X-Namat-Service-Key"], key);
  assert.equal(sent.init.redirect, "error");
  assert.equal(sent.init.credentials, "omit");
  assert.deepEqual(JSON.parse(sent.init.body), {
    operation: "getInventoryReviews",
    input: params,
  });
  const failing = sharedAnalysisStore({
    env,
    fetchImpl: async () =>
      Response.json({ error: "conflict" }, { status: 409 }),
  });
  await assert.rejects(() => failing.saveDecision({}), { code: "conflict" });
  const malformed = sharedAnalysisStore({
    env,
    fetchImpl: async () => Response.json({ result: null, secret: "extra" }),
  });
  await assert.rejects(() => malformed.budget({}), { code: "unavailable" });
});
test("an approved review becomes the patient's results email, previewed then sent once per decision", async () => {
  const h = harness();
  Object.assign(h.state.patient, {
    first_name: "Lucía",
    email: "lucia.demo@example.com",
    answers: { ...h.state.patient.answers, location: "abu-dhabi" },
  });
  const run = await generated(h);
  const email = (body, options = h.options) =>
    patientEmailResponse(request({ body }), params, options);
  let response = await email({ runId: run.runId, send: false });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "not_approved");
  const chosen = run.plan.tests.slice(0, 2);
  response = await decisionResponse(
    request({
      body: {
        ...decisionBody(run),
        selectedTestIds: chosen.map((item) => item.id),
      },
    }),
    params,
    h.options,
  );
  assert.equal(response.status, 200);
  response = await email({ runId: run.runId, send: true, message: 7 });
  assert.equal(response.status, 400);
  response = await email({
    runId: run.runId,
    send: false,
    message: "See you <soon>.",
  });
  const preview = await response.json();
  assert.equal(response.status, 200, JSON.stringify(preview));
  assert.equal(preview.to, "lucia.demo@example.com");
  assert.equal(preview.mode, "local");
  assert.match(preview.html, /Lucía, your doctor has reviewed your results\./);
  assert.match(preview.text, /Hi Lucía\./);
  assert.match(preview.html, /See you &lt;soon&gt;\./);
  assert.ok(preview.text.includes("Dr Fictional"));
  for (const item of chosen) assert.ok(preview.text.includes(item.name));
  assert.ok(
    preview.text.includes(
      h.state.data.extraction.observations[0].name.split(" ")[0],
    ),
  );
  assert.doesNotMatch(preview.text, /\bbook/i);
  response = await email({ runId: run.runId, send: true });
  assert.deepEqual((await response.json()).delivery, {
    state: "simulated",
    provider: "local",
  });
  const calls = [];
  const live = {
    ...h.options,
    env: {
      ...h.options.env,
      HACKATHON_EMAIL_MODE: "participants",
      HACKATHON_PARTICIPANT_EMAIL_APPROVED: "true",
      BREVO_API_KEY: "fixture-brevo-key",
    },
    async fetcher(url, init) {
      calls.push({ url, init });
      return Response.json({ messageId: "<fixture@brevo>" }, { status: 201 });
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await email({ runId: run.runId, send: true }, live);
    assert.equal((await response.json()).delivery.state, "accepted");
  }
  assert.equal(calls.length, 2);
  const [first, second] = calls.map((call) => JSON.parse(call.init.body));
  assert.deepEqual(first.to, [{ email: "lucia.demo@example.com" }]);
  assert.equal(first.headers.idempotencyKey, second.headers.idempotencyKey);
  response = await patientEmailResponse(
    request({ body: { runId: run.runId, send: true }, user: null }),
    params,
    live,
  );
  assert.notEqual(response.status, 200);
  assert.equal(calls.length, 2);
});
