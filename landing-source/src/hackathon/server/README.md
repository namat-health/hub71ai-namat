# Fictional demo intake API

This module is separate from the permanent journey. It saves fictional questionnaire cases and queues one receipt confirmation. It does not generate recommendations, send reports to a model, expose submitted data through a retrieval endpoint, or implement a doctor's portal.

## Current revision — 30 September 2026

New demo intake requires first name and email. Its model contains only the seven Emirates for location, omits country, pregnancy and current-treatment questions, and adds goal `uae_move` (**“Starting a new life in the UAE”**) leading into motivations. The questionnaire headline is **“Welcome to the UAE. Let’s take care of your health.”** and its badge is **“Demo”**. Contact copy explains that the personalised diagnostic plan follows doctor review and approval; the immediate email only confirms receipt.

The version remains `namat-hackathon-welcome-v1`. Existing fictional records retain their original fields and nullable first names; no migration or historical rewrite accompanies this revision. The permanent questionnaire also requires a first name for new intake. The current revision is published and verified; see [its release checks](../RELEASE-2026-09-30.md#uae-arrival-revision). Earlier results remain listed separately below.

## Integration contract

`processHackathonRequest({method, headers, body}, {env, pool?, sender?})` returns `{status, headers, body}`. Header names are lower case. The Vercel wrapper must enforce `MAX_BODY_BYTES` while receiving the body; the module checks the final body again. A raw Buffer preserves validation of UTF-8 input.

POST `/api/hackathon` accepts:

```js
{
  version: 'namat-hackathon-welcome-v1',
  requestId: '<UUID v4>',
  dataClass: 'synthetic',
  fictionalConfirmed: true,
  email: 'fictional@example.invalid',
  firstName: 'Fictional', // required for new intake
  answers: { /* shared questionnaire model */ },
  notes: { /* shared questionnaire model */ },
  reports: [
    { name: 'fictional.pdf', type: 'application/pdf', size: 123, base64: '...' }
  ]
}
```

The shared model validates and normalises answers/notes. The API validates the contact fields. If `bloodwork` is `yes`, one to three reports are required. If it is `no`, reports must be an empty array. PDF, JPEG and PNG are accepted, with **2 MiB combined decoded bytes** and a **4,000,000-byte request limit**. The client must send canonical base64 without a data-URL prefix or whitespace. Filename extension, MIME type, declared size and file signature/structure must agree. SVG, HTML, executable signatures, truncated images, PNG CRC errors and common PDF scripts/attachments are rejected. These checks are format screening, not a full malware scanner; this version is restricted to fictional files.

`firstName` must be a string with a non-empty trimmed value of at most 80 characters. Control characters, angle brackets and Unicode line/paragraph separators are rejected; Unicode names are otherwise supported. The saved value is trimmed. New `answers` must omit `country`, `pregnancy` and `treatment`; new `notes` must omit `country`. Location must be one of the current model's seven Emirates, not `outside-uae`. The unchanged v1 identifier does not make historical payloads valid new requests: preserve old saved cases as they are instead of revalidating or rewriting them through this intake.

Success is `201 {status:'saved', receiptId, confirmationEmail}`. `confirmationEmail` is:

- `sent`: the provider accepted the confirmation. It is not proof of inbox delivery.
- `disabled`: the sender's policy blocked delivery, or delivery was simulated locally.
- `pending`: the confirmation remains queued, or this request did not invoke a sender. No background sender is deployed here.
- `failed`: the provider rejected the confirmation.
- `unknown`: the email outcome could not be confirmed, including an interrupted `sending` entry or a delivery-state lookup failure. These entries require operator reconciliation before any resend.

All five email states accompany a durably saved submission and its receipt. The success page distinguishes failures and uncertainty, and describes `sent` as handed to the email provider. It does not promise inbox delivery or ask the participant to resubmit a saved questionnaire.

An identical request ID and normalised content return the same receipt. Changed content with that ID returns `409`. Invalid content returns `400`, forbidden origins `403`, unsupported content types `415`, oversized bodies `413`, and unavailable configuration/storage `503`. Errors contain no connection settings, filenames, answer values or provider messages.

GET returns `200 {status:'ready', maxFileBytes}` only when both tables exist and the connection can select and insert in them; otherwise it returns `503 {status:'unavailable', maxFileBytes}`. This is storage readiness, not email-provider readiness. It returns no saved records. Only configured origins can perform JSON POSTs. OPTIONS supports the corresponding JSON preflight.

## Server-only settings

| Setting | Requirement |
|---|---|
| `HACKATHON_ENABLED` | Exactly `true`; otherwise closed. |
| `HACKATHON_DATABASE_URL` | PostgreSQL connection with explicit credentials and database name. Never expose to the browser. |
| `HACKATHON_ALLOWED_ORIGINS` | Comma-separated exact HTTPS origins; local loopback HTTP is accepted for rehearsal. Wildcards, URL credentials and non-root paths are rejected. |
| `HACKATHON_DATABASE_CA` | Optional CA certificate when the connection requires it. |

Every remote database connection verifies TLS certificates. URL flags cannot turn verification off. Explicit loopback connections support the existing local PostgreSQL rehearsal without TLS. Each process uses a maximum of two pooled database connections.

## Storage and migration

The separate [migration](../db/001_welcome_submissions.sql) creates two tables and no roles or grants:

- `hackathon_welcome_submissions`: answers/notes, email and first name, synthetic confirmation, receipt, idempotency fingerprint, binary reports with matching filename/MIME/size/SHA-256 metadata, and expiry. First name is required by new intake; the column remains nullable for historical records.
- `hackathon_email_outbox`: one unique confirmation per submission, minimal recipient fields, receipt reference, report-presence flag and delivery state. It contains no answers, notes, filenames or report bytes.

The submission and its queue entry commit together. An outbox failure rolls back the submission. The report array and byte totals are also constrained in PostgreSQL. Both records receive a 30-day expiry; no automatic deletion job is deployed by this module. Deleting an expired submission cascades to its outbox entry. The event's final cleanup must be run or scheduled separately.

The stored case and report bytes are readable by the approved database operator. Application-level encryption is not added for this fictional-only event; this is not permission to use the schema for real medical records. Applying this migration to Azure and granting a runtime role remain separate authorized operations.

The API role needs database CONNECT, schema USAGE, SELECT/INSERT on both tables, and UPDATE only on these outbox columns: `status`, `claim_token`, `claimed_at`, `attempts`, `provider_message_id`, `last_error_code`, `sent_at`, and `available_at`. The API needs no DELETE, TRUNCATE, sequence, table-creation or migration permissions. An operator handles retention separately. These exact grants were applied to dedicated Azure role `namat_hackathon_runtime` on 30 September; existing journey roles were unchanged.

## Confirmation delivery

Pass the mailer's sender through the API:

```js
processHackathonRequest(request, {
  env,
  sender: message => sendHackathonConfirmation(message, {env})
});
```

`createHackathonStore(pool).deliverReceiptConfirmation(receiptId, sender)` claims only the matching queued entry. `sending` commits before the provider call. The sender receives `{recipientEmail, firstName, hasReports, reference}` only. Its policy controls approved recipients; the store never redirects an address.

The helper maps `accepted` to `sent`, `simulated` to `local`, `blocked` back to `queued` with a block reason, and a known rate limit back to `queued` with a 15–86,400-second delay. This preserves the mailer's provider Retry-After limit of one day. Rejection becomes `failed`. An exception or uncertain outcome becomes `unknown`. Interrupted `sending` and `unknown` entries are held for explicit reconciliation; repeated submissions do not resend them. The queue remains durable when the email operation fails. No background sender is deployed here.

As approved on 1 October 2026, the public Azure demo uses `HACKATHON_EMAIL_MODE=participants` with `HACKATHON_PARTICIPANT_EMAIL_APPROVED=true`, so new submissions can receive confirmations at their submitted address. Local and older fallback settings were not broadened, and the protected permanent questionnaire still has external delivery disabled. Earlier blocked messages are not automatically replayed. See [confirmation-email.mjs](confirmation-email.mjs) for the server-only policy. Use synthetic sender callbacks in tests; live submissions now require an approved recipient/send.

The visible email notice is **“Demo · Fictional health information”**. Internal route, table, environment-variable and version names retain `hackathon` for compatibility.

## Earlier-release verification

The following results were recorded before the UAE-only and required-name revision. Current revision results are recorded separately in the release record; the historical counts below describe the earlier source.

```sh
node --test tests/hackathon-server.test.mjs
# Explicit loopback URL supplied privately:
node --test tests/hackathon-postgres.test.mjs
```

The native suite reads `HACKATHON_TEST_DATABASE_URL`, refuses remote hosts, creates one random schema and removes it afterward. Eight unit tests and seven real PostgreSQL tests passed on 30 September 2026. They cover file validation, synthetic/origin/body gates, race-safe retries, binary persistence, atomic queue rollback, concurrent delivery claims, provider retry delays, uncertain outcomes and successful-save behavior when delivery fails. All provider callbacks in those tests are synthetic; no email is sent.

For browser QA, the separate **local** `namat_hackathon` database was created and migrated, and the three storage settings were written to private `.env.hackathon.local` while preserving its email settings. The subsequent [Azure setup](../../../output/hackathon-azure-setup-2026-09-30.json) applied both tables and created the dedicated restricted login, with 41 checks passing. The Azure URL is stored privately outside the repository; the local environment file was not replaced. No event records, external emails or deployment were produced by that setup. Hosted browser verification remains separate.

## Receipt and upload investigation — 1 October 2026

The public demo now reports `failed` and `unknown` email outcomes separately from `pending`. Provider acceptance says the confirmation has been handed to the email provider. The submission remains saved in all three cases. This does not add delivery tracking or a background retry worker.

The supplied screenshot receipt was a local preview record; Brevo subsequently reported it delivered on 30 September at 19:47 Dubai time. Two public Gmail confirmations on 1 October were accepted, but the observed provider history contains only request events, and an all-folder Gmail search found no message. Sender/domain authentication, credits, suppression and paused-queue checks passed. A provider delivery trace is still needed; the status correction alone does not establish Gmail delivery.

The supplied valid PDF was rejected before storage because embedded C2PA Content Credentials matched the validator’s attachment and SVG substring rules. Report bytes are already stored in PostgreSQL. Upload validation is unchanged in this release. The recommended next change is structural PDF inspection with explicit C2PA support and precise errors, followed by private object storage and asynchronous extraction when larger report handling is introduced.

See [sanitized diagnosis](../../../output/receipt-investigation-2026-10-01/diagnosis.json), [live checks](../../../output/receipt-investigation-2026-10-01/live-verification.json), and [unsent Brevo support draft](../../../output/receipt-investigation-2026-10-01/brevo-support-draft.txt).
