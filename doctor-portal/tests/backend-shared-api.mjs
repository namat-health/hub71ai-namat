import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  healthResponse,
  sourceResponse,
  submissionsResponse,
} from "../lib/portal-backend.mjs";
import { SHARED_API_ORIGIN } from "../lib/shared-api.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const tenant = "33333333-3333-4333-8333-333333333333";
const submissionId = "8deb6350-ccb3-4644-a751-87ac104c5db2";
const reportId = "d4c2d7d1-39c6-4c01-a988-98248dd2513a";
const receiptId = "44444444-4444-4444-8444-444444444444";
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
const bytes = Buffer.from("%PDF-1.7\nfictional original report\n%%EOF");
const hash = createHash("sha256").update(bytes).digest("hex");
const sourceUrl = `/api/submissions/${submissionId}/reports/${reportId}/source`;
const submission = {
  id: submissionId,
  receipt_id: receiptId,
  questionnaire_version: "namat-hackathon-welcome-v1",
  data_class: "synthetic",
  fictional_confirmed: true,
  answers: { bloodwork: "yes" },
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
      size: bytes.length,
      status: "ready",
      sourceUrl,
    },
  ],
};
const list = () => ({ submissions: [structuredClone(submission)] });
function request({
  user = owner,
  directory = tenant,
  provider = "aad",
  path = "/api/submissions",
  headers = {},
  download = false,
} = {}) {
  const principal = {
    auth_typ: provider,
    claims: [
      { typ: "oid", val: user },
      { typ: "tid", val: directory },
    ],
  };
  return new Request(
    `https://${hostname}${path}${download ? "?download=1" : ""}`,
    {
      headers: {
        ...(user
          ? {
              "X-MS-CLIENT-PRINCIPAL": Buffer.from(
                JSON.stringify(principal),
              ).toString("base64"),
            }
          : {}),
        ...headers,
      },
    },
  );
}
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
function source(data = bytes, headers = {}, status = 200) {
  const responseHeaders = new Headers({
    "Content-Type": "application/pdf",
    "Content-Length": String(data.length),
    "X-Namat-Content-Sha256": createHash("sha256").update(data).digest("hex"),
    "Content-Disposition":
      "inline; filename=\"original.pdf\"; filename*=UTF-8''original.pdf",
  });
  for (const [name, value] of Object.entries(headers))
    responseHeaders.set(name, value);
  return new Response(data, { status, headers: responseHeaders });
}
function options(upstream = () => json(list()), overrides = {}) {
  const calls = { pools: 0, fetches: [] };
  return {
    env,
    now,
    calls,
    getPool() {
      calls.pools++;
      throw new Error("SECRET DATABASE_URL must not be required in API mode");
    },
    async fetchImpl(url, init) {
      calls.fetches.push({ url, init });
      return upstream(url, init);
    },
    ...overrides,
  };
}
const handlers = [
  (req, opts) => submissionsResponse(req, opts),
  (req, opts) => sourceResponse(req, { submissionId, reportId }, opts),
  (req, opts) => healthResponse(req, opts),
];

test("all three routes retain Microsoft account, tenant, provider and origin checks before either backend", async () => {
  for (const run of handlers) {
    for (const [req, status] of [
      [request({ user: null }), 401],
      [request({ user: receiptId }), 403],
      [request({ directory: receiptId }), 403],
      [request({ provider: "google" }), 401],
      [request({ headers: { Origin: "https://attacker.example" } }), 403],
      [
        request({
          headers: { Host: "attacker.example", "X-Forwarded-Host": hostname },
        }),
        403,
      ],
    ]) {
      const opts = options();
      const response = await run(req, opts);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(opts.calls.pools, 0);
      assert.equal(opts.calls.fetches.length, 0);
    }
    const opts = options(undefined, {
      env: { ...env, WEBSITE_INSTANCE_ID: "" },
    });
    assert.equal((await run(request(), opts)).status, 503);
    assert.equal(opts.calls.pools, 0);
    assert.equal(opts.calls.fetches.length, 0);
  }
});

test("listing preserves the existing shape and local source URL with no database or browser credentials", async () => {
  const opts = options();
  const response = await submissionsResponse(request(), opts);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), list());
  assert.equal(opts.calls.pools, 0);
  assert.equal(opts.calls.fetches.length, 1);
  const [{ url, init }] = opts.calls.fetches;
  assert.equal(url, `${SHARED_API_ORIGIN}/v1/demo/submissions`);
  assert.equal(init.headers["X-Namat-Service-Key"], key);
  assert.equal(init.headers["Accept-Encoding"], "identity");
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
  assert.equal(init.cache, "no-store");
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(init.headers["X-MS-CLIENT-PRINCIPAL"], undefined);
  assert.equal(response.headers.get("x-namat-service-key"), null);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("historical submissions preserve a null first name without rejecting the list", async () => {
  const historical = list();
  historical.submissions[0].first_name = null;
  const opts = options(() => json(historical));
  const response = await submissionsResponse(request(), opts);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), historical);
  assert.equal(opts.calls.pools, 0);
});

test("current v2 questionnaires load alone and alongside historical v1 submissions", async () => {
  const current = {
    ...structuredClone(submission),
    id: "55555555-5555-4555-8555-555555555555",
    questionnaire_version: "namat-hackathon-welcome-v2",
    answers: { height_cm: "175", weight_kg: "70", bloodwork: "no" },
    attached_reports: [],
  };
  for (const submissions of [[current], [current, submission]]) {
    const expected = { submissions };
    const opts = options(() => json(expected));
    const response = await submissionsResponse(request(), opts);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.equal(opts.calls.pools, 0);
    assert.equal(opts.calls.fetches.length, 1);
  }
});

test("unrecognized questionnaire versions still reject the list without database fallback", async () => {
  for (const version of ["namat-hackathon-welcome-v3", "", null]) {
    const data = list();
    data.submissions[0].questionnaire_version = version;
    const opts = options(() => json(data));
    const response = await submissionsResponse(request(), opts);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Could not load patient submissions. Please try again.",
    });
    assert.equal(opts.calls.pools, 0);
  }
});

test("enabled mode fails closed for missing/misconfigured origin or token without database fallback", async () => {
  for (const change of [
    { NAMAT_SHARED_API_ORIGIN: "https://attacker.example" },
    { NAMAT_SHARED_API_ORIGIN: `${SHARED_API_ORIGIN}/` },
    { NAMAT_SHARED_API_ORIGIN: `${SHARED_API_ORIGIN}?credential=SECRET` },
    {
      NAMAT_SHARED_API_ORIGIN:
        "https://secret@namat-api-staging-uaen-001.azurewebsites.net",
    },
    { NAMAT_SHARED_API_PORTAL_TOKEN: "" },
    { NAMAT_SHARED_API_PORTAL_TOKEN: "SECRET\r\nInjected" },
  ]) {
    for (const run of handlers) {
      const opts = options(undefined, { env: { ...env, ...change } });
      const response = await run(request(), opts);
      assert.ok([502, 503].includes(response.status));
      assert.equal(opts.calls.pools, 0);
      assert.equal(opts.calls.fetches.length, 0);
      assert.doesNotMatch(
        await response.text(),
        /SECRET|DATABASE_URL|fixture-only/,
      );
    }
  }
});

test("upstream failures, redirects and dropped connections remain sanitized and never query the database", async () => {
  for (const upstream of [
    () => new Response("SECRET", { status: 503 }),
    () => new Response("SECRET", { status: 401 }),
    () =>
      new Response(null, {
        status: 307,
        headers: { Location: "https://attacker.example" },
      }),
    () => {
      throw new Error(`SECRET ${key}`);
    },
  ]) {
    for (const run of handlers) {
      const opts = options(upstream);
      const response = await run(request(), opts);
      assert.ok([502, 503].includes(response.status));
      assert.equal(opts.calls.pools, 0);
      assert.equal(opts.calls.fetches.length, 1);
      assert.doesNotMatch(await response.text(), /SECRET|fixture-only/);
    }
  }
});

test("list rejects raw storage fields, unsafe source URLs, unrelated records and oversized/malformed responses", async () => {
  const invalid = [
    () => {
      const value = list();
      value.submissions[0].blob_key = "SECRET";
      return json(value);
    },
    () => {
      const value = list();
      value.submissions[0].attached_reports[0].sourceUrl =
        "https://attacker.example";
      return json(value);
    },
    () => {
      const value = list();
      value.submissions[0].attached_reports[0].sourceUrl = sourceUrl.replace(
        submissionId,
        receiptId,
      );
      return json(value);
    },
    () => {
      const value = list();
      value.submissions[0].data_class = "patient";
      return json(value);
    },
    () => {
      const value = list();
      value.submissions[0].fictional_confirmed = false;
      return json(value);
    },
    () => {
      const value = list();
      value.submissions[0].expires_at = "2026-09-30T11:00:00Z";
      return json(value);
    },
    () => json({ submissions: [submission, submission] }),
    () => json(list(), 200, { "content-length": "2097153" }),
    () =>
      new Response(" ".repeat(2 * 1024 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
    () =>
      new Response("{", { headers: { "content-type": "application/json" } }),
    () =>
      new Response("<html>SECRET</html>", {
        headers: { "content-type": "text/html" },
      }),
  ];
  for (const upstream of invalid) {
    const opts = options(upstream);
    const response = await submissionsResponse(request(), opts);
    assert.equal(response.status, 503);
    assert.equal(opts.calls.pools, 0);
    assert.doesNotMatch(await response.text(), /SECRET|attacker/);
  }
});

test("source keeps exact submission/report binding, validates bytes and recreates private headers", async () => {
  const opts = options(() => source());
  const response = await sourceResponse(
    request({ path: sourceUrl }),
    { submissionId, reportId },
    opts,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(opts.calls.pools, 0);
  assert.equal(
    opts.calls.fetches[0].url,
    `${SHARED_API_ORIGIN}/v1/demo/submissions/${submissionId}/reports/${reportId}`,
  );
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.match(
    response.headers.get("content-disposition"),
    /^inline; filename="original\.pdf"/,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-namat-content-sha256"), null);
  for (const reference of ["legacy-0", "legacy-1", "legacy-2"]) {
    const legacyOptions = options(() => source());
    assert.equal(
      (
        await sourceResponse(
          request(),
          { submissionId, reportId: reference },
          legacyOptions,
        )
      ).status,
      200,
    );
    assert.equal(
      legacyOptions.calls.fetches[0].url,
      `${SHARED_API_ORIGIN}/v1/demo/submissions/${submissionId}/reports/${reference}`,
    );
    assert.equal(legacyOptions.calls.pools, 0);
  }
});

test("source rejects invalid references before transport and preserves upstream binding denial as 404", async () => {
  for (const params of [
    { submissionId: "../private", reportId },
    { submissionId, reportId: "legacy-3" },
    { submissionId, reportId: `${reportId}?private=1` },
    { submissionId, reportId: `https://attacker.example` },
  ]) {
    const opts = options();
    const response = await sourceResponse(request(), params, opts);
    assert.equal(response.status, 404);
    assert.equal(opts.calls.fetches.length, 0);
    assert.equal(opts.calls.pools, 0);
  }
  const opts = options(() => new Response("SECRET", { status: 404 }));
  const response = await sourceResponse(
    request(),
    { submissionId: receiptId, reportId },
    opts,
  );
  assert.equal(response.status, 404);
  assert.equal(opts.calls.pools, 0);
  assert.equal(
    opts.calls.fetches[0].url,
    `${SHARED_API_ORIGIN}/v1/demo/submissions/${receiptId}/reports/${reportId}`,
  );
  assert.doesNotMatch(await response.text(), /SECRET/);
});

test("source refuses wrong hashes, content types, truncated/extra bytes, missing lengths and fake formats", async () => {
  for (const upstream of [
    () => source(bytes, { "x-namat-content-sha256": "0".repeat(64) }),
    () => source(bytes, { "content-type": "text/html" }),
    () => source(bytes, { "content-length": "10485761" }),
    () => source(bytes, { "content-length": String(bytes.length - 1) }),
    () => source(bytes, { "content-length": String(bytes.length + 1) }),
    () =>
      new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "x-namat-content-sha256": hash,
        },
      }),
    () => source(Buffer.from("not a PDF")),
    () => source(bytes, { "x-namat-content-sha256": "" }),
  ]) {
    const opts = options(upstream);
    const response = await sourceResponse(
      request(),
      { submissionId, reportId },
      opts,
    );
    assert.equal(response.status, 502);
    assert.equal(opts.calls.pools, 0);
  }
});

test("PNG/JPEG download retains original bytes and hostile filenames cannot create response headers", async () => {
  for (const [mime, image] of [
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ["image/jpeg", Buffer.from([255, 216, 255, 0])],
  ]) {
    const opts = options(() =>
      source(image, {
        "content-type": mime,
        "content-disposition":
          "inline; filename*=UTF-8''%C3%A9vil%0D%0AInjected%3Ayes%2Fname",
      }),
    );
    const response = await sourceResponse(
      request({ download: true }),
      { submissionId, reportId },
      opts,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    assert.equal(response.headers.get("content-type"), mime);
    assert.match(response.headers.get("content-disposition"), /^attachment;/);
    assert.equal(response.headers.has("Injected"), false);
    assert.doesNotMatch(response.headers.get("content-disposition"), /[\r\n]/);
  }
});

test("health probes the API readiness without requiring DATABASE_URL and preserves the UI shape", async () => {
  const opts = options(() => json({ status: "ready" }));
  const response = await healthResponse(request(), opts);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, database: "connected" });
  assert.equal(opts.calls.pools, 0);
  assert.equal(opts.calls.fetches[0].url, `${SHARED_API_ORIGIN}/v1/demo/ready`);
  const bad = options(() => json({ status: "ok" }));
  assert.equal((await healthResponse(request(), bad)).status, 503);
  assert.equal(bad.calls.pools, 0);
});

test("full-response deadline bounds missing headers and stalled report/list streams without fallback", async () => {
  for (const run of handlers) {
    const opts = options(async () => new Promise(() => {}), { timeoutMs: 100 });
    const response = await run(request(), opts);
    assert.ok([502, 503].includes(response.status));
    assert.equal(opts.calls.pools, 0);
    assert.equal(opts.calls.fetches.length, 1);
  }
  const pending = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("{"));
        },
      }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  const opts = options(pending, { timeoutMs: 100 });
  assert.equal((await submissionsResponse(request(), opts)).status, 503);
  assert.equal(opts.calls.pools, 0);
});

test("disabled mode retains the legacy read path and does not contact the API", async () => {
  let pools = 0,
    queries = 0;
  const opts = options(undefined, {
    env: { ...env, NAMAT_SHARED_API_ENABLED: "false" },
    getPool() {
      pools++;
      return {
        async query(sql) {
          queries++;
          return { rows: sql === "SELECT 1" ? [{ value: 1 }] : [] };
        },
      };
    },
  });
  assert.deepEqual(await (await submissionsResponse(request(), opts)).json(), {
    submissions: [],
  });
  assert.equal((await healthResponse(request(), opts)).status, 200);
  assert.equal(
    (await sourceResponse(request(), { submissionId, reportId }, opts)).status,
    404,
  );
  assert.equal(pools, 3);
  assert.equal(queries, 3);
  assert.equal(opts.calls.fetches.length, 0);
});
