import assert from "node:assert/strict";
import test from "node:test";
import { principalName } from "../lib/portal-access.mjs";
import {
  analysisContextResponse,
  confirmationResponse,
  extractionResponse,
  planResponse,
} from "../lib/portal-backend.mjs";
import { SHARED_API_ORIGIN } from "../lib/shared-api.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const tenant = "33333333-3333-4333-8333-333333333333";
const submissionId = "8deb6350-ccb3-4644-a751-87ac104c5db2";
const reportId = "d4c2d7d1-39c6-4c01-a988-98248dd2513a";
const extractionId = "f6e4f9f3-5be8-4e23-8c1a-bb46aff4735c";
const key = "fixture-only-service-key-0123456789abcdef";
const hostname = "doctor-test.azurewebsites.net";
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
const now = Date.parse("2026-10-01T12:00:00Z");
const params = { submissionId, reportId };
const extractionPath = `/v1/demo/submissions/${submissionId}/reports/${reportId}/extraction`;

function draft() {
  return {
    report: { id: reportId, status: "ready", pageCount: 2 },
    extraction: {
      id: extractionId,
      processorVersion: "namat-lab-draft-2026-10-01.1:native",
      createdAt: "2026-10-01T10:00:00.000Z",
      pages: [
        { number: 1, unit: "pt" },
        { number: 2, unit: "pt" },
      ],
      observations: [
        {
          name: "Ferritin",
          value: "14",
          unit: "ng/mL",
          referenceRange: "15 - 150",
          date: null,
          sourceText: "Ferritin 14 ng/mL 15 - 150",
          page: 2,
          bounds: { x: 44, y: 120, width: 300, height: 11 },
        },
      ],
      warnings: ["Draft values require comparison with the source report."],
    },
    review: null,
    reviewRevision: 0,
  };
}

const submission = {
  id: submissionId,
  receipt_id: "44444444-4444-4444-8444-444444444444",
  questionnaire_version: "namat-hackathon-welcome-v1",
  data_class: "synthetic",
  fictional_confirmed: true,
  answers: { priority: "prevention", symptoms: ["recovery"] },
  notes: {},
  email: "fictional@example.invalid",
  first_name: "Fictional",
  created_at: "2026-10-01T11:00:00Z",
  expires_at: "2026-10-02T11:00:00Z",
  attached_reports: [
    {
      id: reportId,
      name: "original.pdf",
      mime: "application/pdf",
      size: 40,
      status: "ready",
      sourceUrl: `/api/submissions/${submissionId}/reports/${reportId}/source`,
    },
  ],
};

function request({
  user = owner,
  method = "GET",
  origin = method === "GET" ? undefined : `https://${hostname}`,
  name = "Dr. Fictional Reviewer",
  path = "/api",
  body,
  type = "application/json",
} = {}) {
  const claims = [
    { typ: "oid", val: user },
    { typ: "tid", val: tenant },
  ];
  if (name !== null) claims.push({ typ: "name", val: name });
  return new Request(`https://${hostname}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": type }),
      ...(user
        ? {
            "X-MS-CLIENT-PRINCIPAL": Buffer.from(
              JSON.stringify({ auth_typ: "aad", claims }),
            ).toString("base64"),
          }
        : {}),
      ...(origin ? { Origin: origin } : {}),
    },
  });
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

function options(routes = {}, overrides = {}) {
  const calls = { pools: 0, fetches: [] };
  return {
    env,
    now,
    calls,
    analysisStore: {
      async getInventoryReviews() {
        return [];
      },
    },
    getPool() {
      calls.pools++;
      throw new Error("SECRET DATABASE_URL must not be required in API mode");
    },
    async fetchImpl(url, init) {
      calls.fetches.push({ url, init });
      const path = url.slice(SHARED_API_ORIGIN.length);
      const route =
        routes[path] ||
        (path.endsWith("/evidence-v1")
          ? routes[path.replace("/evidence-v1", "/extraction")]
          : null);
      if (!route) return json({ status: "error" }, 404);
      const response = await route(url, init);
      if (!path.endsWith("/evidence-v1") || !response.ok) return response;
      const value = await response.json();
      value.evidenceVersion = "namat-report-evidence-v1";
      if (value.extraction) {
        value.extraction.inputSha256 = null;
        value.extraction.pages = value.extraction.pages.map((page) => ({
          ...page,
          text: "Synthetic report",
          lines: [],
        }));
      }
      for (const item of [
        ...(value.extraction?.observations || []),
        ...(value.review?.observations || []),
      ])
        Object.assign(item, {
          dateKind: "unknown",
          dateSourceText: null,
          dateSourcePage: null,
        });
      return json(value);
    },
    ...overrides,
  };
}

test("extraction maps the parser draft to lab values with page boxes", async () => {
  const opts = options({ [extractionPath]: () => json(draft()) });
  const response = await extractionResponse(request(), params, opts);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.reportId, reportId);
  assert.equal(body.pageCount, 2);
  assert.equal(
    body.extraction.processorVersion,
    "namat-lab-draft-2026-10-01.1:native",
  );
  assert.deepEqual(body.extraction.labs, [
    {
      id: "ferritin",
      marker: "ferritin",
      name: "Ferritin",
      short: "Ferritin",
      value: 14,
      display: "14",
      comparator: null,
      unit: "ng/mL",
      refLow: 15,
      refHigh: 150,
      refText: "15 – 150",
      flag: "low",
      panel: "Iron & vitamins",
      page: 2,
      bbox: [44, 120, 300, 11],
      confidence: null,
      note: null,
      confirmed: false,
      observationIndex: 0,
      reportId,
    },
  ]);
  assert.equal(opts.calls.pools, 0);
  assert.equal(opts.calls.fetches.length, 1);
  const [{ init }] = opts.calls.fetches;
  assert.equal(init.headers["X-Namat-Service-Key"], key);
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
});

test("extraction and plan routes keep the Microsoft and origin checks before any backend", async () => {
  for (const [run, method] of [
    [(req, opts) => extractionResponse(req, params, opts), "GET"],
    [(req, opts) => planResponse(req, { submissionId }, opts), "POST"],
  ]) {
    for (const [req, status] of [
      [request({ method, user: null }), 401],
      [request({ method, user: submissionId }), 403],
      [request({ method, origin: "https://attacker.example" }), 403],
    ]) {
      const opts = options();
      assert.equal((await run(req, opts)).status, status);
      assert.equal(opts.calls.pools, 0);
      assert.equal(opts.calls.fetches.length, 0);
    }
  }
  // A cross-site form post carries no Origin from this workspace.
  const opts = options();
  const response = await planResponse(
    request({ method: "POST", origin: null }),
    { submissionId },
    opts,
  );
  assert.equal(response.status, 403);
  assert.equal(opts.calls.fetches.length, 0);
});

test("extraction rejects unexpected upstream shapes and never reads legacy attachments", async () => {
  const invalid = [
    (value) => {
      value.extraction.pages[0].text = "SECRET page text";
    },
    (value) => {
      value.report.id = submissionId;
    },
    (value) => {
      value.extraction.pages[0].unit = "cm";
    },
    (value) => {
      value.extraction.observations[0].bounds = [1, 2, 3];
    },
    (value) => {
      value.extraction.observations[0].page = 0;
    },
    (value) => {
      value.extraction.observations[0].value = 14;
    },
    (value) => {
      value.extraction.reviews = [];
    },
  ];
  for (const change of invalid) {
    const value = draft();
    change(value);
    const opts = options({ [extractionPath]: () => json(value) });
    const response = await extractionResponse(request(), params, opts);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /SECRET/);
  }
  const missing = options();
  assert.equal(
    (await extractionResponse(request(), params, missing)).status,
    404,
  );
  const legacy = options();
  const response = await extractionResponse(
    request(),
    { submissionId, reportId: "legacy-0" },
    legacy,
  );
  assert.equal(response.status, 404);
  assert.equal(legacy.calls.fetches.length, 0);
  const pending = options({
    [extractionPath]: () =>
      json({
        report: { id: reportId, status: "processing", pageCount: null },
        extraction: null,
        review: null,
        reviewRevision: 0,
      }),
  });
  assert.deepEqual(
    await (await extractionResponse(request(), params, pending)).json(),
    {
      reportId,
      status: "processing",
      pageCount: null,
      revision: 0,
      extraction: null,
    },
  );
});

test("direct database mode reads the latest draft for the bound report only", async () => {
  const row = {
    id: reportId,
    submission_id: submissionId,
    mime: "application/pdf",
    status: "ready",
    page_count: 2,
    expires_at: "2026-10-02T11:00:00Z",
    data_class: "synthetic",
    fictional_confirmed: true,
    submission_expires_at: "2026-10-02T11:00:00Z",
    extraction_id: extractionId,
    processor_version: "namat-lab-draft-2026-10-01.1:native",
    extracted_at: new Date("2026-10-01T10:00:00Z"),
    pages: [
      { number: 1, text: "SECRET page text", lines: [] },
      { number: 2, lines: [] },
    ],
    observations: [
      { ...draft().extraction.observations[0], reviewRequired: true },
    ],
    warnings: [],
  };
  const queries = [];
  const direct = {
    env: { ...env, NAMAT_SHARED_API_ENABLED: "false" },
    now,
    getPool: () => ({
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [row] };
      },
    }),
  };
  const response = await extractionResponse(request(), params, direct);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.extraction.labs[0].id, "ferritin");
  assert.doesNotMatch(JSON.stringify(body), /SECRET/);
  assert.deepEqual(queries[0].values, [reportId, submissionId]);
  assert.match(queries[0].sql, /ORDER BY created_at DESC,id DESC LIMIT 1/);
  row.submission_id = reportId;
  assert.equal(
    (await extractionResponse(request(), params, direct)).status,
    404,
  );
});

test("plan generation binds to an active submission and sends no name or email to the generator", async () => {
  let input;
  const opts = options(
    {
      "/v1/demo/submissions": () => json({ submissions: [submission] }),
      [extractionPath]: () => json(draft()),
    },
    {
      async generatePlan(value) {
        input = value;
        const { generatePlan } = await import(
          "../lib/plan-preview-fixture.mjs"
        );
        return generatePlan(value);
      },
    },
  );
  const response = await planResponse(
    request({ method: "POST" }),
    { submissionId },
    opts,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "placeholder");
  assert.equal(body.plan.findings.length, 5);
  assert.deepEqual(input.questionnaire, {
    version: "namat-hackathon-welcome-v1",
    answers: submission.answers,
    notes: {},
  });
  assert.equal(input.labs[0].id, "ferritin");
  assert.equal(input.labs[0].bbox, undefined);
  assert.doesNotMatch(
    JSON.stringify(input),
    /fictional@example|Fictional|original\.pdf/,
  );
});

test("plan generation refuses unknown submissions and invalid generator output", async () => {
  const routes = {
    "/v1/demo/submissions": () => json({ submissions: [submission] }),
    [extractionPath]: () => json(draft()),
  };
  const unknown = options(routes);
  assert.equal(
    (
      await planResponse(
        request({ method: "POST" }),
        { submissionId: reportId },
        unknown,
      )
    ).status,
    404,
  );
  const malformed = options();
  assert.equal(
    (
      await planResponse(
        request({ method: "POST" }),
        { submissionId: "not-a-uuid" },
        malformed,
      )
    ).status,
    404,
  );
  assert.equal(malformed.calls.fetches.length, 0);
  const invalid = options(routes, {
    generatePlan: async () => ({
      plan: { summaryShort: "SECRET" },
      source: "test",
    }),
  });
  const response = await planResponse(
    request({ method: "POST" }),
    { submissionId },
    invalid,
  );
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /SECRET/);
  // An attached report without a draft must not silently become an answers-only plan.
  let input;
  const undrafted = options(
    { "/v1/demo/submissions": () => json({ submissions: [submission] }) },
    {
      async generatePlan(value) {
        input = value;
        const { generatePlan } = await import(
          "../lib/plan-preview-fixture.mjs"
        );
        return generatePlan(value);
      },
    },
  );
  assert.equal(
    (
      await planResponse(
        request({ method: "POST" }),
        { submissionId },
        undrafted,
      )
    ).status,
    409,
  );
  assert.equal(input, undefined);
  const brokenDraft = options({
    "/v1/demo/submissions": () => json({ submissions: [submission] }),
    [extractionPath]: () => json({ status: "error" }, 503),
  });
  assert.equal(
    (
      await planResponse(
        request({ method: "POST" }),
        { submissionId },
        brokenDraft,
      )
    ).status,
    503,
  );
  const failing = options({
    "/v1/demo/submissions": () => json({ status: "error" }, 503),
  });
  assert.equal(
    (await planResponse(request({ method: "POST" }), { submissionId }, failing))
      .status,
    503,
  );
});

test("the signed-in display name is cleaned and never required", () => {
  assert.equal(principalName(request()), "Dr. Fictional Reviewer");
  assert.equal(
    principalName(request({ name: " Amira\u0000 <Khan> " })),
    "Amira Khan",
  );
  assert.equal(principalName(request({ name: "12345" })), null);
  assert.equal(principalName(request({ name: null })), null);
  assert.equal(principalName(request({ user: null })), null);
});

const reviewPath = `/v1/demo/submissions/${submissionId}/reports/${reportId}/reviews`;
const vitaminD = {
  name: "25-OH Vitamin D",
  value: "18",
  unit: null,
  referenceRange: "30 - 100",
  date: null,
  sourceText: "25-OH Vitamin D 18 30 - 100 ng/mL",
  page: 2,
  bounds: { x: 44, y: 140, width: 300, height: 11 },
};

function flagged() {
  const value = draft();
  value.extraction.observations.push(vitaminD);
  return value;
}

// The shared API and engine, kept in memory: reviews apply on the next read.
function reviewingRoutes({ conflict = false } = {}) {
  const saved = [];
  return {
    saved,
    routes: {
      [extractionPath]: () => {
        const value = flagged();
        const latest = saved.at(-1);
        if (latest) {
          value.review = {
            revision: saved.length,
            decision: "corrected",
            createdAt: "2026-10-01T12:00:00.000Z",
            observations: latest.observations.map((item) => ({
              ...item,
              confirmed: item.confirmed === true,
            })),
          };
          value.reviewRevision = saved.length;
        }
        return json(value);
      },
      [reviewPath]: (_url, init) => {
        if (conflict)
          return json({ status: "error", code: "stale_review" }, 409);
        saved.push(JSON.parse(init.body));
        return json({
          review: {
            revision: saved.length,
            createdAt: "2026-10-01T12:00:00.000Z",
          },
        });
      },
      "/v1/demo/submissions": () => json({ submissions: [submission] }),
    },
  };
}

const confirm = (change = {}) =>
  request({
    method: "POST",
    body: { extractionId, revision: 0, index: 1, action: "confirm", ...change },
  });

test("looks right saves the full list as the next review by the signed-in doctor", async () => {
  const { routes, saved } = reviewingRoutes();
  const opts = options(routes);
  const response = await confirmationResponse(confirm(), params, opts);
  assert.equal(response.status, 200);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    extractionId,
    expectedReviewRevision: 0,
    observations: [
      {
        name: "Ferritin",
        value: "14",
        unit: "ng/mL",
        referenceRange: "15 - 150",
        date: null,
        sourceText: "Ferritin 14 ng/mL 15 - 150",
        page: 2,
      },
      {
        name: "25-OH Vitamin D",
        value: "18",
        unit: "ng/mL",
        referenceRange: "30 - 100",
        date: null,
        sourceText: "25-OH Vitamin D 18 30 - 100 ng/mL",
        page: 2,
        confirmed: true,
      },
    ],
    actor: `Dr. Fictional Reviewer (microsoft:${owner})`,
  });
  const [post] = opts.calls.fetches.filter(
    ({ init }) => init.method === "POST",
  );
  assert.equal(post.init.headers["Content-Type"], "application/json");
  assert.equal(post.init.headers["X-Namat-Service-Key"], key);
  const body = await response.json();
  assert.equal(body.revision, 1);
  const checked = body.extraction.labs.find(
    (lab) => lab.marker === "vitamin-d-25-oh",
  );
  assert.equal(checked.note, null);
  assert.equal(checked.confirmed, true);
  assert.deepEqual(checked.bbox, [44, 140, 300, 11]);
});

test("fix saves the doctor's value in place of the reading", async () => {
  const { routes, saved } = reviewingRoutes();
  const response = await confirmationResponse(
    confirm({
      action: "correct",
      value: "19",
      unit: "ng/mL",
      referenceRange: "30 – 100",
    }),
    params,
    options(routes),
  );
  assert.equal(response.status, 200);
  assert.equal(saved[0].observations[1].value, "19");
  assert.equal(saved[0].observations[1].referenceRange, "30 – 100");
  assert.equal(saved[0].observations[1].confirmed, true);
  const invalid = reviewingRoutes();
  const refused = await confirmationResponse(
    confirm({ action: "correct", value: " " }),
    params,
    options(invalid.routes),
  );
  assert.equal(refused.status, 400);
  assert.equal(invalid.saved.length, 0);
});

test("a stale view or an upstream conflict is refused without overwriting anything", async () => {
  for (const change of [
    { revision: 1 },
    { extractionId: reportId },
    { index: 9 },
  ]) {
    const { routes, saved } = reviewingRoutes();
    const response = await confirmationResponse(
      confirm(change),
      params,
      options(routes),
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "stale");
    assert.equal(saved.length, 0);
  }
  const conflicting = reviewingRoutes({ conflict: true });
  const response = await confirmationResponse(
    confirm(),
    params,
    options(conflicting.routes),
  );
  assert.equal(response.status, 409);
});

test("malformed confirmations stop before any upstream call", async () => {
  const bodies = [
    "{not json",
    { extractionId, revision: 0, index: 1 },
    { extractionId, revision: -1, index: 1, action: "confirm" },
    { extractionId, revision: 0, index: 1.5, action: "confirm" },
    { extractionId, revision: 0, index: 1, action: "delete" },
    "x".repeat(5000),
  ];
  for (const body of bodies) {
    const opts = options(reviewingRoutes().routes);
    const response = await confirmationResponse(
      request({ method: "POST", body }),
      params,
      opts,
    );
    assert.equal(response.status, 400);
    assert.equal(opts.calls.fetches.length, 0);
  }
  const opts = options(reviewingRoutes().routes);
  const plainText = request({ method: "POST", body: "{}", type: "text/plain" });
  assert.equal(
    (await confirmationResponse(plainText, params, opts)).status,
    400,
  );
  assert.equal(opts.calls.fetches.length, 0);
});

test("confirmations keep the Microsoft and origin checks and need the shared API", async () => {
  for (const [req, status] of [
    [request({ method: "POST", user: null, body: {} }), 401],
    [
      request({ method: "POST", origin: "https://attacker.example", body: {} }),
      403,
    ],
  ]) {
    const opts = options(reviewingRoutes().routes);
    assert.equal(
      (await confirmationResponse(req, params, opts)).status,
      status,
    );
    assert.equal(opts.calls.fetches.length, 0);
  }
  const direct = options(
    {},
    { env: { ...env, NAMAT_SHARED_API_ENABLED: "false" } },
  );
  assert.equal(
    (await confirmationResponse(confirm(), params, direct)).status,
    503,
  );
  assert.equal(direct.calls.pools, 0);
});

test("the plan waits until every flagged value is checked", async () => {
  const { routes } = reviewingRoutes();
  let generated = 0;
  const generatePlan = async (value) => {
    generated += 1;
    const { generatePlan: placeholder } = await import(
      "../lib/plan-preview-fixture.mjs"
    );
    return placeholder(value);
  };
  const waiting = await planResponse(
    request({ method: "POST" }),
    { submissionId },
    options(routes, { generatePlan }),
  );
  assert.equal(waiting.status, 409);
  assert.equal((await waiting.json()).code, "values_to_confirm");
  assert.equal(generated, 0);
  assert.equal(
    (await confirmationResponse(confirm(), params, options(routes))).status,
    200,
  );
  const ready = await planResponse(
    request({ method: "POST" }),
    { submissionId },
    options(routes, { generatePlan }),
  );
  assert.equal(ready.status, 200);
  assert.equal(generated, 1);
});

test("analysis context is authenticated, comes from the stored case and carries provenance", async () => {
  const routes = {
    "/v1/demo/submissions": () => json({ submissions: [submission] }),
    [extractionPath]: () => json(draft()),
  };
  const denied = await analysisContextResponse(
    request({ user: null }),
    params,
    options(routes),
  );
  assert.equal(denied.status, 401);
  const result = await analysisContextResponse(
    request(),
    params,
    options(routes),
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  const { caseContext } = await result.json();
  assert.equal(caseContext.observations[0].reportId, reportId);
  assert.equal(
    caseContext.questionnaire.version,
    submission.questionnaire_version,
  );
  assert.ok(caseContext.knowledge.claims.length > 0);
  assert.ok(!JSON.stringify(caseContext).includes(submission.email));
});
