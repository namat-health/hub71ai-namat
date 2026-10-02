import assert from "node:assert/strict";
import test from "node:test";
import { portalJson, requirePortalSession } from "../lib/portal-access.mjs";

const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hostname = "namat-doctor-test.azurewebsites.net";
const env = {
  NAMAT_PORTAL_AUTH_MODE: "azure-easy-auth",
  NAMAT_PORTAL_TENANT_ID: tenant,
  NAMAT_PORTAL_ALLOWED_USER_IDS: owner,
  WEBSITE_SITE_NAME: "namat-doctor-test",
  WEBSITE_HOSTNAME: hostname,
  WEBSITE_INSTANCE_ID: "f".repeat(64),
};
const oid = "http://schemas.microsoft.com/identity/claims/objectidentifier";
const tid = "http://schemas.microsoft.com/identity/claims/tenantid";

function identity({
  user = owner,
  directory = tenant,
  provider = "aad",
  claims,
} = {}) {
  return {
    auth_typ: provider,
    claims: claims || [
      { typ: oid, val: user },
      { typ: tid, val: directory },
    ],
    name_typ: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    role_typ: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
  };
}

function request({
  data = identity(),
  headers = {},
  method = "GET",
  url = `https://${hostname}/api/submissions`,
} = {}) {
  return new Request(url, {
    method,
    headers: {
      ...(data
        ? {
            "X-MS-CLIENT-PRINCIPAL": Buffer.from(JSON.stringify(data)).toString(
              "base64",
            ),
          }
        : {}),
      ...headers,
    },
  });
}

test("fails closed without explicit mode, tenant, allowlist or Azure runtime markers", () => {
  assert.equal(requirePortalSession(request(), { env: {} }).status, 503);
  for (const key of Object.keys(env)) {
    const missing = { ...env };
    delete missing[key];
    assert.equal(
      requirePortalSession(request(), { env: missing }).status,
      503,
      key,
    );
  }
  for (const override of [
    { NAMAT_PORTAL_AUTH_MODE: "local-token" },
    { NAMAT_PORTAL_TENANT_ID: "*" },
    { NAMAT_PORTAL_ALLOWED_USER_IDS: "" },
    { NAMAT_PORTAL_ALLOWED_USER_IDS: `${owner},` },
    { NAMAT_PORTAL_ALLOWED_USER_IDS: `${owner},*` },
    { WEBSITE_HOSTNAME: "localhost" },
    { WEBSITE_HOSTNAME: `${hostname}.attacker.example` },
    { WEBSITE_HOSTNAME: `${hostname}:443` },
    { WEBSITE_INSTANCE_ID: "" },
  ])
    assert.equal(
      requirePortalSession(request(), { env: { ...env, ...override } }).status,
      503,
    );
});

test("accepts Azure's mapped claims for an allowed account without creating another session", () => {
  assert.equal(requirePortalSession(request(), { env }), null);
  assert.equal(
    requirePortalSession(
      request({
        headers: {
          "X-MS-CLIENT-PRINCIPAL-ID": owner,
          "X-MS-CLIENT-PRINCIPAL-IDP": "aad",
        },
      }),
      { env },
    ),
    null,
  );
  assert.equal(
    requirePortalSession(
      request({
        data: identity({
          claims: [
            { typ: "oid", val: owner.toUpperCase() },
            { typ: "tid", val: tenant.toUpperCase() },
          ],
        }),
      }),
      { env },
    ),
    null,
  );
  assert.equal(
    requirePortalSession(request({ data: identity({ user: other }) }), {
      env: { ...env, NAMAT_PORTAL_ALLOWED_USER_IDS: `${owner}, ${other}` },
    }),
    null,
  );
});

test("denies anonymous callers and ignores cookies, tokens, names or convenience headers alone", () => {
  for (const headers of [
    {},
    { Cookie: "AppServiceAuthSession=made-up" },
    { Authorization: "Bearer fictional-test-token" },
    { "X-MS-CLIENT-PRINCIPAL-ID": owner, "X-MS-CLIENT-PRINCIPAL-IDP": "aad" },
    { "X-MS-CLIENT-PRINCIPAL-NAME": "owner@example.test" },
  ])
    assert.equal(
      requirePortalSession(request({ data: null, headers }), { env }).status,
      401,
    );
});

test("rejects a different user or tenant even when principal names look identical", () => {
  assert.equal(
    requirePortalSession(request({ data: identity({ user: other }) }), { env })
      .status,
    403,
  );
  assert.equal(
    requirePortalSession(request({ data: identity({ directory: other }) }), {
      env,
    }).status,
    403,
  );
  assert.equal(
    requirePortalSession(
      request({
        data: identity({ user: other }),
        headers: { "X-MS-CLIENT-PRINCIPAL-NAME": "owner@example.test" },
      }),
      { env },
    ).status,
    403,
  );
});

test("rejects wrong providers and inconsistent identity convenience headers", () => {
  assert.equal(
    requirePortalSession(request({ data: identity({ provider: "google" }) }), {
      env,
    }).status,
    401,
  );
  assert.equal(
    requirePortalSession(
      request({ headers: { "X-MS-CLIENT-PRINCIPAL-IDP": "google" } }),
      { env },
    ).status,
    401,
  );
  assert.equal(
    requirePortalSession(
      request({ headers: { "X-MS-CLIENT-PRINCIPAL-ID": other } }),
      { env },
    ).status,
    401,
  );
});

test("rejects ambiguous, malformed and missing identity claims", () => {
  const valid = identity().claims;
  for (const claims of [
    [],
    [{ typ: oid, val: owner }],
    [{ typ: tid, val: tenant }],
    [...valid, { typ: oid, val: other }],
    [...valid, { typ: "oid", val: owner }],
    [...valid, { typ: "tid", val: tenant }],
    [...valid, null],
    [
      { typ: oid, val: {} },
      { typ: tid, val: tenant },
    ],
    [
      { typ: oid, val: "*" },
      { typ: tid, val: tenant },
    ],
    [
      ...valid,
      ...Array.from({ length: 127 }, () => ({ typ: "role", val: "test" })),
    ],
  ])
    assert.equal(
      requirePortalSession(request({ data: identity({ claims }) }), { env })
        .status,
      401,
    );
});

test("rejects malformed, concatenated, invalid UTF-8 and oversized principal headers", () => {
  const encoded = Buffer.from(JSON.stringify(identity())).toString("base64");
  for (const value of [
    "not-base64!",
    `${encoded},${encoded}`,
    `${encoded}===`,
    Buffer.from("not json").toString("base64"),
    Buffer.from([255, 254]).toString("base64"),
    Buffer.from("null").toString("base64"),
    "a".repeat(16385),
  ])
    assert.equal(
      requirePortalSession(
        request({ data: null, headers: { "X-MS-CLIENT-PRINCIPAL": value } }),
        { env },
      ).status,
      401,
    );
});

test("forged Azure headers outside Azure do not authorize local development", () => {
  const localRequest = request({
    url: "http://127.0.0.1:3000/api/submissions",
  });
  assert.equal(requirePortalSession(localRequest, { env: {} }).status, 503);
  const localConfig = { ...env };
  delete localConfig.WEBSITE_INSTANCE_ID;
  assert.equal(
    requirePortalSession(localRequest, { env: localConfig }).status,
    503,
  );
  // Even copied Azure configuration does not make a localhost request trusted.
  assert.equal(requirePortalSession(localRequest, { env }).status, 403);
  assert.equal(
    requirePortalSession(
      request({
        url: "http://localhost:3000/api/submissions",
        headers: { "X-Forwarded-Host": hostname },
      }),
      { env },
    ).status,
    403,
  );
});

test("supports Azure HTTPS termination and rejects a different host or origin", () => {
  assert.equal(
    requirePortalSession(
      request({
        url: "http://0.0.0.0:8080/api/submissions",
        headers: {
          Host: hostname,
          Origin: `https://${hostname}`,
          "Sec-Fetch-Site": "same-origin",
        },
      }),
      { env },
    ),
    null,
  );
  assert.equal(
    requirePortalSession(
      request({
        headers: { Host: "attacker.example", "X-Forwarded-Host": hostname },
      }),
      { env },
    ).status,
    403,
  );
  assert.equal(
    requirePortalSession(
      request({ headers: { Origin: "https://attacker.example" } }),
      { env },
    ).status,
    403,
  );
  assert.equal(
    requirePortalSession(
      request({ headers: { Origin: `http://${hostname}` } }),
      { env },
    ).status,
    403,
  );
  for (const site of ["cross-site", "same-site"]) {
    assert.equal(
      requirePortalSession(request({ headers: { "Sec-Fetch-Site": site } }), {
        env,
      }).status,
      403,
    );
  }
  assert.equal(
    requirePortalSession(request({ headers: { "Sec-Fetch-Site": "none" } }), {
      env,
    }),
    null,
  );
});

test("mutation requests require an exact same-origin browser request", () => {
  assert.equal(
    requirePortalSession(request({ method: "POST" }), { env }).status,
    403,
  );
  assert.equal(
    requirePortalSession(
      request({ method: "POST", headers: { Origin: `https://${hostname}` } }),
      { env },
    ),
    null,
  );
  assert.equal(
    requirePortalSession(
      request({
        method: "POST",
        headers: {
          Origin: `https://${hostname}`,
          "Sec-Fetch-Site": "cross-site",
        },
      }),
      { env },
    ).status,
    403,
  );
});

test("JSON responses and denials are private and do not set cookies or reveal claims", async () => {
  const custom = portalJson({ error: "Try later." }, 429, {
    "Retry-After": "30",
    "Cache-Control": "public",
  });
  assert.equal(custom.headers.get("retry-after"), "30");
  assert.equal(custom.headers.get("cache-control"), "private, no-store");
  assert.equal(custom.headers.get("x-content-type-options"), "nosniff");
  assert.equal(custom.headers.has("set-cookie"), false);
  const denied = requirePortalSession(
    request({ data: identity({ user: other }) }),
    { env },
  );
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  const body = await denied.text();
  assert.equal(body.includes(owner), false);
  assert.equal(body.includes(tenant), false);
  assert.equal(body.includes(other), false);
});

test("custom domain keeps tenant/user and same-origin protections", () => {
  const custom = {
    ...env,
    NAMAT_PORTAL_CUSTOM_HOSTNAME: "doctor.namat.health",
  };
  const url = "https://doctor.namat.health/api/submissions";
  assert.equal(requirePortalSession(request({ url }), { env }).status, 403);
  assert.equal(requirePortalSession(request({ url }), { env: custom }), null);
  assert.equal(
    requirePortalSession(
      request({
        url,
        method: "POST",
        headers: { Origin: "https://doctor.namat.health" },
      }),
      { env: custom },
    ),
    null,
  );
  assert.equal(
    requirePortalSession(
      request({
        url,
        method: "POST",
        headers: { Origin: `https://${hostname}` },
      }),
      { env: custom },
    ).status,
    403,
  );
  assert.equal(
    requirePortalSession(request({ url, data: identity({ user: other }) }), {
      env: custom,
    }).status,
    403,
  );
  assert.equal(
    requirePortalSession(request({ url, headers: { Host: "evil.example" } }), {
      env: custom,
    }).status,
    403,
  );
});
