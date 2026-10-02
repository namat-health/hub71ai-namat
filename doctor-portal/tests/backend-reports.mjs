import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { listSubmissions, reportSourceResponse } from "../lib/report-files.mjs";

const key = "fictional-test-key-with-more-than-thirty-two-characters";
const ownerId = "11111111-1111-4111-8111-111111111111";
const tenantId = "33333333-3333-4333-8333-333333333333";
const env = {
  NAMAT_REPORT_REVIEW_TOKEN: key,
  NAMAT_PORTAL_AUTH_MODE: "azure-easy-auth",
  NAMAT_PORTAL_TENANT_ID: tenantId,
  NAMAT_PORTAL_ALLOWED_USER_IDS: ownerId,
  WEBSITE_SITE_NAME: "doctor-test",
  WEBSITE_HOSTNAME: "doctor-test.azurewebsites.net",
  WEBSITE_INSTANCE_ID: "fictional-instance-id",
};
const principal = Buffer.from(
  JSON.stringify({
    auth_typ: "aad",
    claims: [
      {
        typ: "http://schemas.microsoft.com/identity/claims/objectidentifier",
        val: ownerId,
      },
      {
        typ: "http://schemas.microsoft.com/identity/claims/tenantid",
        val: tenantId,
      },
    ],
  }),
).toString("base64");
const now = Date.parse("2026-10-01T12:00:00Z");
const submissionId = "8deb6350-ccb3-4644-a751-87ac104c5db2";
const reportId = "d4c2d7d1-39c6-4c01-a988-98248dd2513a";
const otherId = "22222222-2222-4222-8222-222222222222";
const future = "2026-10-02T12:00:00Z";
const past = "2026-09-30T12:00:00Z";
const bytes = Buffer.from("%PDF-1.7\nfictional report fixture\n%%EOF");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const report = {
  id: reportId,
  submission_id: submissionId,
  name: "blood-count.pdf",
  mime: "application/pdf",
  size: bytes.length,
  sha256,
  status: "ready",
  expires_at: future,
  submission_expires_at: future,
  data_class: "synthetic",
  fictional_confirmed: true,
};
function request({ authenticated = true, download = false } = {}) {
  return new Request(
    `https://doctor-test.azurewebsites.net/api/submissions/${submissionId}/reports/${reportId}/source${download ? "?download=1" : ""}`,
    {
      headers: authenticated
        ? {
            "X-MS-CLIENT-PRINCIPAL": principal,
            "X-MS-CLIENT-PRINCIPAL-ID": ownerId,
            "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
          }
        : {},
    },
  );
}
function options(
  row = report,
  upstream = () =>
    new Response(bytes, { headers: { "Content-Type": row.mime } }),
) {
  const calls = { queries: 0, fetches: 0 };
  return {
    calls,
    env,
    now,
    pool: {
      query: async (sql, params) => {
        calls.queries += 1;
        calls.sql = sql;
        calls.params = params;
        return { rows: row ? [row] : [] };
      },
    },
    fetchImpl: async (url, init) => {
      calls.fetches += 1;
      calls.url = url;
      calls.init = init;
      return upstream();
    },
  };
}

test("source denies missing session before database or network access", async () => {
  const opts = options();
  const response = await reportSourceResponse(
    request({ authenticated: false }),
    { submissionId, reportId },
    opts,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(opts.calls, { queries: 0, fetches: 0 });
});

test("source binds both IDs and rejects wrong submission, expired/unconfirmed/non-synthetic or unavailable reports before network", async () => {
  for (const row of [
    null,
    { ...report, submission_id: otherId },
    { ...report, id: otherId },
    { ...report, expires_at: past },
    { ...report, submission_expires_at: past },
    { ...report, submission_expires_at: null },
    { ...report, fictional_confirmed: false },
    { ...report, data_class: "patient" },
    { ...report, status: "uploading" },
    { ...report, status: "rejected" },
  ]) {
    const opts = options(row);
    assert.equal(
      (await reportSourceResponse(request(), { submissionId, reportId }, opts))
        .status,
      404,
    );
    assert.equal(opts.calls.fetches, 0);
    assert.deepEqual(opts.calls.params, [reportId, submissionId]);
    assert.match(opts.calls.sql, /r\.id=\$1 AND r\.submission_id=\$2/);
  }
});

test("valid PDF is proxied from a fixed origin using server bearer and returned privately with original name", async () => {
  const opts = options();
  const response = await reportSourceResponse(
    request(),
    { submissionId, reportId },
    opts,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(
    opts.calls.url,
    `https://start.namat.health/api/reports/${reportId}/source`,
  );
  assert.equal(opts.calls.init.headers.Authorization, `Bearer ${key}`);
  assert.equal(opts.calls.init.headers.Origin, undefined);
  assert.equal(opts.calls.init.redirect, "error");
  assert.equal(opts.calls.init.cache, "no-store");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(
    response.headers.get("content-disposition"),
    /^inline; filename="blood-count\.pdf"/,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
});

test("invalid MIME, wrong hash, truncated/oversized bodies, fake PDF, redirects and upstream failures are sanitized", async () => {
  const cases = [
    [
      report,
      () => new Response(bytes, { headers: { "Content-Type": "text/html" } }),
    ],
    [
      { ...report, sha256: "0".repeat(64) },
      () =>
        new Response(bytes, { headers: { "Content-Type": "application/pdf" } }),
    ],
    [
      report,
      () =>
        new Response(bytes.subarray(0, 10), {
          headers: { "Content-Type": "application/pdf" },
        }),
    ],
    [
      report,
      () =>
        new Response(Buffer.concat([bytes, bytes]), {
          headers: { "Content-Type": "application/pdf" },
        }),
    ],
    [
      report,
      () =>
        new Response(bytes, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": "999999999",
          },
        }),
    ],
    [
      { ...report, mime: "text/html" },
      () => {
        throw new Error("should not fetch");
      },
    ],
    [
      { ...report, size: 10485761 },
      () => {
        throw new Error("should not fetch");
      },
    ],
    [
      {
        ...report,
        sha256: createHash("sha256")
          .update(Buffer.from("x".repeat(bytes.length)))
          .digest("hex"),
      },
      () =>
        new Response("x".repeat(bytes.length), {
          headers: { "Content-Type": "application/pdf" },
        }),
    ],
    [report, () => new Response("upstream secret", { status: 403 })],
    [
      report,
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example" },
        }),
    ],
    [
      report,
      () => {
        throw new Error(`private upstream detail ${key}`);
      },
    ],
  ];
  for (const [row, upstream] of cases) {
    const response = await reportSourceResponse(
      request(),
      { submissionId, reportId },
      options(row, upstream),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "The report could not be opened. Please try again.",
    });
  }
});

test("PNG and JPEG originals can be viewed/downloaded and filename cannot inject headers", async () => {
  for (const [mime, image] of [
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ["image/jpeg", Buffer.from([255, 216, 255, 0])],
  ]) {
    const row = {
      ...report,
      mime,
      name: 'fake";\r\nInjected: yes/é',
      size: image.length,
      sha256: createHash("sha256").update(image).digest("hex"),
    };
    const response = await reportSourceResponse(
      request({ download: true }),
      { submissionId, reportId },
      options(
        row,
        () => new Response(image, { headers: { "Content-Type": mime } }),
      ),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
    assert.match(response.headers.get("content-disposition"), /^attachment;/);
    assert.equal(response.headers.has("injected"), false);
    assert.equal(
      /[\r\n]/.test(response.headers.get("content-disposition")),
      false,
    );
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  }
});

test("legacy attachment uses bound submission/index, validates bytes and never calls cloud storage", async () => {
  const legacy = {
    id: submissionId,
    data_class: "synthetic",
    fictional_confirmed: true,
    expires_at: future,
    metadata: {
      name: "legacy.pdf",
      type: "application/pdf",
      size: bytes.length,
      sha256,
    },
    bytes,
  };
  const opts = options(legacy);
  const response = await reportSourceResponse(
    request(),
    { submissionId, reportId: "legacy-0" },
    opts,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(opts.calls.params, [submissionId, 0]);
  assert.equal(opts.calls.fetches, 0);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(
    (
      await reportSourceResponse(
        request(),
        { submissionId, reportId: "legacy-3" },
        opts,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await reportSourceResponse(
        request(),
        { submissionId, reportId: "legacy-0" },
        options({ ...legacy, bytes: Buffer.from("corrupt") }),
      )
    ).status,
    502,
  );
});

test("listing returns safe attachment references only, filters expiry and deduplicates backfilled originals", async () => {
  const row = {
    id: submissionId,
    first_name: "Fictional test",
    data_class: "synthetic",
    fictional_confirmed: true,
    expires_at: future,
    report_metadata: [
      {
        name: "legacy.pdf",
        type: "application/pdf",
        size: bytes.length,
        sha256,
      },
      {
        name: "another.pdf",
        type: "application/pdf",
        size: bytes.length,
        sha256: "f".repeat(64),
      },
    ],
    legacy_report_count: 2,
    report_files: [bytes],
    fingerprint: "secret fingerprint",
  };
  const sqls = [];
  const pool = {
    query: async (sql) => {
      sqls.push(sql);
      return {
        rows:
          sqls.length === 1
            ? [row, { ...row, id: otherId, expires_at: past }]
            : [
                report,
                {
                  ...report,
                  id: otherId,
                  sha256: "e".repeat(64),
                  status: "rejected",
                },
              ],
      };
    },
  };
  const listed = await listSubmissions(pool, { now });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].attached_reports.length, 3);
  assert.equal(
    listed[0].attached_reports[0].sourceUrl,
    `/api/submissions/${submissionId}/reports/${reportId}/source`,
  );
  assert.equal(listed[0].attached_reports[1].sourceUrl, null);
  assert.equal(listed[0].attached_reports[2].id, "legacy-1");
  const serialized = JSON.stringify(listed);
  for (const forbidden of [
    "sha256",
    "blob_key",
    "blob_url",
    "report_files",
    "report_metadata",
    "fingerprint",
    sha256,
  ])
    assert.equal(serialized.includes(forbidden), false);
  assert.equal(
    sqls.some((sql) => /SELECT\s+\*/i.test(sql)),
    false,
  );
});

test("missing report-service credential fails without a network request", async () => {
  const opts = options();
  opts.env = { ...env, NAMAT_REPORT_REVIEW_TOKEN: "" };
  const response = await reportSourceResponse(
    request(),
    { submissionId, reportId },
    opts,
  );
  assert.equal(response.status, 503);
  assert.equal(opts.calls.fetches, 0);
  assert.equal(JSON.stringify(await response.json()).includes(key), false);
});
