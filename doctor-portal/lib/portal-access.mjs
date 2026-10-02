const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID_CLAIMS = new Set([
  "oid",
  "http://schemas.microsoft.com/identity/claims/objectidentifier",
]);
const TENANT_ID_CLAIMS = new Set([
  "tid",
  "http://schemas.microsoft.com/identity/claims/tenantid",
]);

export function portalJson(body, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { status, headers: responseHeaders });
}

function configuration(env) {
  if (env.NAMAT_PORTAL_AUTH_MODE !== "azure-easy-auth") return null;
  const tenant = env.NAMAT_PORTAL_TENANT_ID;
  const users = env.NAMAT_PORTAL_ALLOWED_USER_IDS;
  const hostname = env.WEBSITE_HOSTNAME;
  if (
    typeof tenant !== "string" ||
    !UUID.test(tenant) ||
    typeof users !== "string" ||
    users.length > 4096 ||
    typeof env.WEBSITE_SITE_NAME !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,59}$/i.test(env.WEBSITE_SITE_NAME) ||
    typeof env.WEBSITE_INSTANCE_ID !== "string" ||
    !/^[a-z0-9_-]{16,256}$/i.test(env.WEBSITE_INSTANCE_ID) ||
    typeof hostname !== "string" ||
    !/^(?:[a-z0-9][a-z0-9-]{0,62}\.)+azurewebsites\.net$/i.test(hostname)
  )
    return null;
  const customHostname = env.NAMAT_PORTAL_CUSTOM_HOSTNAME;
  if (customHostname && customHostname !== "doctor.namat.health") return null;
  const allowedUsers = users.split(",").map((id) => id.trim().toLowerCase());
  if (!allowedUsers.length || allowedUsers.some((id) => !UUID.test(id)))
    return null;
  return {
    tenant: tenant.toLowerCase(),
    allowedUsers: new Set(allowedUsers),
    hostname: hostname.toLowerCase(),
    hostnames: new Set([
      hostname.toLowerCase(),
      ...(customHostname ? [customHostname] : []),
    ]),
  };
}

function identityClaim(claims, names) {
  const matches = claims.filter((claim) => names.has(claim.typ));
  // Reject duplicate identity claims, including mixed mapped/unmapped claims.
  if (matches.length !== 1 || !UUID.test(matches[0].val)) return null;
  return matches[0].val.toLowerCase();
}

function principalClaims(request) {
  const encoded = request.headers.get("x-ms-client-principal");
  if (
    !encoded ||
    encoded.length > 16384 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    return null;
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
    )
      return null;
    const decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      decoded?.auth_typ !== "aad" ||
      !Array.isArray(decoded.claims) ||
      decoded.claims.length > 128 ||
      decoded.claims.some(
        (claim) =>
          !claim ||
          typeof claim.typ !== "string" ||
          typeof claim.val !== "string",
      )
    )
      return null;
    return decoded.claims;
  } catch {
    return null;
  }
}

function principal(request) {
  const claims = principalClaims(request);
  if (!claims) return null;
  const objectId = identityClaim(claims, OBJECT_ID_CLAIMS);
  const tenantId = identityClaim(claims, TENANT_ID_CLAIMS);
  const provider = request.headers.get("x-ms-client-principal-idp");
  const principalId = request.headers.get("x-ms-client-principal-id");
  if (
    !objectId ||
    !tenantId ||
    (provider && provider !== "aad") ||
    (principalId && principalId.toLowerCase() !== objectId)
  )
    return null;
  return { objectId, tenantId };
}

function sameOrigin(request, hostnames) {
  // Next may see HTTP behind Azure's HTTPS termination. The configured platform
  // hostname and original Host header are authoritative; forwarded hosts are not.
  const host = request.headers.get("host") || new URL(request.url).host;
  if (!hostnames.has(host.toLowerCase())) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  const expectedOrigin = `https://${host.toLowerCase()}`;
  if (origin && origin !== expectedOrigin) return false;
  return ["GET", "HEAD"].includes(request.method) || origin === expectedOrigin;
}

/**
 * The signed-in user's display name, for showing in the workspace only. Call
 * it after requirePortalSession has accepted the same request; it never grants
 * or checks access.
 */
export function principalName(request) {
  const claims = principalClaims(request);
  const value = claims?.find((claim) => claim.typ === "name")?.val;
  if (typeof value !== "string") return null;
  const name = value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip controls from an identity claim before display.
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return /\p{L}/u.test(name) ? name : null;
}

/**
 * Who is acting, for audit records such as a saved review: the Microsoft
 * object ID and display name. Call it after requirePortalSession accepted the
 * same request.
 */
export function portalIdentity(request) {
  return {
    objectId: principal(request)?.objectId || null,
    name: principalName(request),
  };
}

// Server routes only. This trusts Azure's authenticated transport, not a signed
// token supplied to this module. App Service must require Microsoft sign-in on
// every path, disable other providers, and enforce the same tenant/user allowlist.
// Azure strips externally supplied identity headers before injecting its own:
// https://learn.microsoft.com/azure/app-service/configure-authentication-user-identities
// Never set the WEBSITE_* platform markers in a public non-Azure deployment.
export function requirePortalSession(request, { env = process.env } = {}) {
  const config = configuration(env);
  if (!config)
    return portalJson(
      { error: "The private workspace is not configured." },
      503,
    );
  const current = principal(request);
  if (!current)
    return portalJson(
      { error: "Sign in with your Microsoft account to continue." },
      401,
    );
  if (
    current.tenantId !== config.tenant ||
    !config.allowedUsers.has(current.objectId)
  ) {
    return portalJson(
      { error: "This account does not have access to the workspace." },
      403,
    );
  }
  if (!sameOrigin(request, config.hostnames))
    return portalJson({ error: "Use the private workspace to continue." }, 403);
  return null;
}
