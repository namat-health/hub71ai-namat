# Namat API contract — synthetic intake

This document describes the isolated `/v1/submissions` interface. The connected questionnaire/doctor demo uses the separately scoped [`/v1/demo` interface](../../../docs/demo-integration.md), preserving the existing records, larger uploads and emails.

Contract release **0.2.0** describes the implemented synthetic intake boundary in two modes:

- Local development: `http://127.0.0.1:4340`.
- Authenticated Azure staging: `https://namat-api-staging-uaen-001.azurewebsites.net`.

Staging is deployed with separate credentials and records in the `namat_api_staging` schema. It accepts fictional cases only. Neither mode provides a clinical portal API or sends email. The staging bearer token is an environment access credential, not a patient or doctor identity; keep it in trusted server-side clients and never embed it in browser code.

- [`openapi.json`](openapi.json): OpenAPI 3.1 contract and a fictional example for local development. The hosted `/v1/openapi.json` response applies the staging server address, bearer security, 401 responses and staging limits. Fetch that document through an authenticated server client when generating a staging integration.
- [`client.d.ts`](client.d.ts): dependency-free TypeScript request and response types. These are types only, not an HTTP client implementation.

## Versioning

Three identifiers have different jobs:

| Identifier | Meaning |
| --- | --- |
| `/v1` | HTTP API compatibility version. |
| `version: "namat-hackathon-welcome-v1"` | Existing source questionnaire model identifier. |
| `questionnaireRevision: "uae-arrival-2026-09-30"` | Exact questionnaire shape accepted by this first API slice. |

The revision is required on every submission. Both database schemas pin it as a separate field; it is not inferred from the current date. A future questionnaire revision needs explicit validation, storage and migration support. Existing saved answers must retain their original interpretation. The contract release number, **0.2.0**, identifies this specification release independently of those three identifiers.

## Implemented operations

| Operation | Result |
| --- | --- |
| `GET /healthz` | Process is responding: `{"status":"ok"}`. |
| `GET /readyz` | The configured storage is available: `{"status":"ready"}`; otherwise HTTP 503 with `{"status":"unavailable"}`. |
| `GET /v1/openapi.json` | This OpenAPI document. |
| `HEAD /healthz`, `HEAD /readyz`, `HEAD /v1/openapi.json` | The same status and headers as GET with an empty body, including errors. |
| `POST /v1/submissions` | Validates and durably saves a fictional questionnaire and pending confirmation record. |
| `OPTIONS /v1/submissions` | Browser preflight for an allowed origin and JSON POST. |

Staging requires `Authorization: Bearer <token>` for readiness, contract discovery and submissions, including protected HEAD requests. Generic liveness and valid submission preflight are public. Authorization does not provide a case-reading capability.

A successful POST returns HTTP 201 and exactly `status`, `receiptId` and `confirmationEmail`. A new submission returns `pending`; an idempotent replay reports the stored confirmation outcome. Neither API mode contacts an email provider. A separate one-shot local worker can simulate an acknowledgement without sending email. No worker or email dispatch is enabled for staging, so staging confirmations remain queued.

| `confirmationEmail` | Meaning |
| --- | --- |
| `pending` | The notification is queued or in progress. |
| `simulated` | The local worker completed a simulation; no message was sent. |
| `accepted` | Stored provider acceptance, which does not prove delivery. Neither API mode creates a provider send. |
| `failed` | A stored failed outcome. Replaying the questionnaire does not retry it. |
| `unknown` | A stored uncertain outcome held for reconciliation. Replaying the questionnaire does not retry it. |

Normal local operation uses `pending` and `simulated`; current staging uses `pending`. The other states preserve any recorded outcome accurately instead of resetting it or claiming that a notification is still pending. External dispatch, delivery confirmation and automatic recovery remain separate milestones.

No case-reading, patient-reading, plan, login or clinical approval endpoint is implemented. A receipt is a reference, not a credential for accessing a record. Do not build callers against the proposed future operations in the wider implementation plan until their authorization rules and contracts are implemented.

## Duplicate submissions and tracing

The JSON body's `requestId` is a caller-created UUIDv4. Keep it unchanged when retrying the same submission after a timeout. A replay of the same normalized content returns the original receipt with HTTP 201. Changed content with the same key returns HTTP 409 and `idempotency_conflict`; a deliberate new submission uses a new key. Changing answer order or harmless whitespace can normalize to the same stored content.

`X-Request-Id` is a separate server-generated trace UUID on every response. Error bodies repeat this trace in `requestId`; they never echo the body idempotency key into that field. Use the trace to investigate a request without logging answers, contact information or report bytes.

Application errors use `{status: "error", code, message, requestId}`. Readiness has its own intentionally small 503 response, and HEAD always has an empty body. Malformed HTTP framing can be rejected by Node with an empty 400 before the application runs; disconnected or timed-out sockets may not return a response. Unknown routes return `not_found`; unsupported methods return `method_not_allowed` with an `Allow` header. URLs must match exactly: query strings and trailing slashes do not resolve. In staging, Host and supplied Origin checks run first, then private requests authenticate before route lookup. Missing or invalid credentials therefore return HTTP 401 with `unauthorized` and `WWW-Authenticate: Bearer realm="namat-staging"`, including for unknown private routes; an authenticated request to an unknown route returns 404. HEAD error responses remain empty. Responses use `Cache-Control: private, no-store`.

Both modes admit at most 60 authorized POST attempts per fixed 60-second window, including malformed submissions. Local development permits at most four submissions in flight; staging permits one to limit load on the shared B1 plan. Either limit returns 429 with `Retry-After: 60`. Host, Origin, authentication and preflight rejections happen before this limit. All reports in a staging submission share a 30-second inspection budget. These are process-wide limits for controlled synthetic use; they are not distributed production abuse controls.

## Validation

The JSON schema defines all permitted fields and answer options. Object schemas reject unknown fields. `notes` is optional; all other top-level submission fields are required. Notes support only the six named optional detail boxes, up to 200 characters each.

The server also runs the existing questionnaire's branch validation:

- Only active questions may hold answers. Inactive questions may be omitted or sent as either an empty array or empty string; the server accepts both for compatibility and normalizes them to the question's expected empty type. Active questions must use their proper type.
- Every active question needs an answer. Curiosity alone skips motivations; other goal combinations require them.
- More than one motivation requires a priority selected from those motivations. The related detail questions follow the selected motivations.
- Hormone options for periods and menopause are available only when `sex` is `female`.
- A sleep detail question appears only when an active symptom or performance question selects sleep.
- “None” cannot be combined with other answers in symptoms, history, sleep or family.
- A nonblank note is valid only when its active question selects “other”. Blank allowed note fields are discarded.
- Recent bloodwork `yes` requires one to three reports; `no` requires an empty report array.

Report objects contain exactly `name`, `type`, `size` and `base64`. Reports must be PDF, JPEG or PNG with a matching filename, canonical base64, a declared byte count matching the decoded file, and a combined decoded size of at most 2 MiB. The runtime validates file structure and rejects known active PDF content. This format screening is not malware scanning. Filenames are limited to 160 characters and 256 UTF-8 bytes. The complete JSON request is limited to 4,000,000 bytes. The schema captures the shape and individual limits; decoded bytes, combined size, file contents and conditional questionnaire rules are runtime checks.

## Client access

In local mode, every request requires a loopback `Host` (`localhost`, `127.0.0.1` or `[::1]`) with the actual listener port. A supplied `Origin` must exactly match an allowed loopback origin, including on probes and contract discovery. POST and OPTIONS require `Origin`, and `Sec-Fetch-Site: cross-site` is rejected for those operations.

In staging, requests require the exact configured public Host. Only generic liveness also accepts loopback health-probe hosts. Forwarded Host headers are never used to bypass this check. Trusted server clients may omit `Origin`; when present it must exactly match a configured HTTPS client origin. Preflight requires an allowed Origin. The allowlist only controls browser origins; an allowed Origin does not replace the required bearer token on protected operations. Do not give a browser the shared staging token: route integration requests through a trusted server.

POST requires `Content-Type: application/json`, optionally followed by `charset=utf-8`; other media-type parameters are rejected. The bytes must be valid UTF-8. `Content-Encoding` must be absent or `identity`: compressed payloads are not accepted. The service does not use browser cookies as credentials or issue browser credentials. A preflight must request `POST`; its requested headers may contain only `Content-Type` in local mode, and `Content-Type` and `Authorization` in staging. An accepted preflight returns 204 without a body and allows `POST, OPTIONS`. Responses to an allowed origin expose `X-Request-Id` for client diagnostics. CORS responses never use a wildcard origin.

The origin allowlist is a browser boundary, not proof of identity. This first service intentionally accepts only fictional data and exposes no read API. Managed user authentication and per-record authorization remain required before adding private case or patient operations; the shared staging credential does not implement either.

## Fictional example

Use the OpenAPI example in local or authenticated synthetic staging tests. Its email domain is reserved for examples; this API slice never sends it mail. `reports: []` corresponds to `bloodwork: "no"`. Keep real contact details and health records out of these tests.

The live demo remains a separate consumer on its existing route. This contract does not switch it to this service or change its current delivery behavior.
