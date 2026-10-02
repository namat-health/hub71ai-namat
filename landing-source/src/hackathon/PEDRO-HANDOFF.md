# Pedro handoff — fictional demo cases

30 September 2026. **The earlier release's intake, Azure storage and staged Vercel API/database path were verified. AI processing, the doctor portal and later recommendation emails are not implemented.** The event permits fictional health answers/reports only. Email addresses may identify the tester and should remain private. The UAE-only and required-name revision is now live; its checks are recorded separately in [the release record](RELEASE-2026-09-30.md#uae-arrival-revision).

## Current revision

The questionnaire opens with **“Welcome to the UAE. Let’s take care of your health.”** and shows the badge **“Demo”**. Locations are the seven Emirates only. New submissions do not contain country, pregnancy or current-treatment questions. The goal `uae_move`, labelled **“Starting a new life in the UAE”**, leads into health motivations. First name and email are required for new demo intake; the permanent questionnaire also requires first name on new intake. The contact introduction distinguishes the immediate receipt confirmation from the personalised diagnostic plan, which follows doctor review and approval.

## Start here

- Shared contract: [questionnaire-model.mjs](welcome/questionnaire-model.mjs), version **`namat-hackathon-welcome-v1`**.
- Intake and response contract: [server/README.md](server/README.md).
- Exact tables and constraints: [001_welcome_submissions.sql](db/001_welcome_submissions.sql).
- Local database: `namat_hackathon`; connection settings are server-only in the private local environment file. Obtain access through Borja; do not copy credentials into source, browser code, issue descriptions or reports.
- Cloud database: existing Azure `namat_journey`, with both event tables and dedicated role `namat_hackathon_runtime` now applied. The [41-check setup report](../../output/hackathon-azure-setup-2026-09-30.json) covers TLS, exact permissions and preserved journey data. The event tables were empty at setup completion; no external email was sent.
- The later [38-check staged rehearsal](HOSTED-VERIFICATION-2026-09-30.md) created exactly two fictional cloud cases and their two blocked confirmation entries. One case has a PNG; bytes and digest were verified. Neither case caused provider acceptance of an email.

## Identifiers and saved answers

`hackathon_welcome_submissions.id` is the internal UUID. `request_id` is the browser's idempotency key; `receipt_id` is the opaque reference shown to the tester and used in the confirmation email. Use `id` as the foreign key for future processing/review records. A receipt is not authorization to view a case.

| Field | Contract |
|---|---|
| `questionnaire_version` | `namat-hackathon-welcome-v1`; reject unsupported versions explicitly. |
| `data_class`, `fictional_confirmed` | Always `synthetic` and `true`, enforced by PostgreSQL. |
| `answers` | JSON object of question IDs to stable option IDs. Single-choice values are strings; multiple-choice values are string arrays in question-option order. Inactive questions still defined in the current model are retained as `''` or `[]`, so an empty value is not a negative answer. Removed questions are absent from new submissions. |
| `notes` | Separate JSON object containing only permitted active follow-up text, keyed by question ID. New submissions have no country note; historical cases may retain `notes.country`. |
| `email`, `first_name` | Required normalized email and non-empty trimmed first name for new intake. Historical first names may be null. Contact data is not an answer. |
| `created_at`, `expires_at` | UTC timestamps; expiry is 30 days after creation. Expired cases must not enter new processing or review. |
| `fingerprint` | SHA-256 of the normalized submission and report metadata/digests. Used for retry conflict detection, not identity or authentication. |

The principal answer groups are:

- Profile: `goals`, `age`, `sex` and `location`. Location is one of Abu Dhabi, Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah or Fujairah; `outside-uae` is no longer accepted.
- Intent: `motivation` and conditional `priority`. `uae_move` is a goal, not a motivation answer, and enters the motivation step. Only curiosity selected alone skips that step.
- Detail: conditional `prevention`, `checkup`, `symptoms`, `history`, `performance`, `weight`, `hormones`, `curiosity` and `sleep`.
- Closing questions: `family`, `bloodwork`.

For cases submitted under the current revision, use `getPath(answers)` and `getQuestion(id, answers)` from the shared model when displaying or interpreting a case. Labels and available hormone/priority options can depend on earlier answers. Do not infer a diagnosis, test order, clinical eligibility or “no symptoms” from an option ID or an inactive empty value.

### Historical compatibility under v1

The identifier remains **`namat-hackathon-welcome-v1`**, so it alone does not distinguish earlier and current record shapes. Previously saved fictional cases retain `country`, `pregnancy`, `treatment`, possible `notes.country`, and nullable first names. No historical record is rewritten. New intake rejects the removed answer/note keys and requires first name.

Keep historical records immutable and preserve those fields when reading or exporting them. Do not run an old case through current intake normalisation to overwrite it: the current model deliberately omits its removed questions. A future historical viewer must handle the saved shape explicitly and recover earlier labels/branch rules from the earlier source revision where needed. Never treat an absent field as a negative answer or invent a first name for an old case.

## Report persistence

There is **no Blob bucket or report URL**. The reports are stored in the same submission row:

| Field | Contract |
|---|---|
| `report_metadata` | JSON array of `{name, type, size, sha256}`. Array order matches the binary files. |
| `report_files` | PostgreSQL `bytea[]`; the Node `pg` driver returns an array of Buffers. |
| `report_total_size` | Sum of decoded file bytes; at most 2,097,152 bytes. |

JavaScript index `i` pairs `report_metadata[i]` with `report_files[i]`. PostgreSQL arrays use index `i + 1`. There are zero reports when `bloodwork='no'`, and one to three when it is `yes`. Types are PDF, JPEG or PNG. The API validates canonical base64, size, extension/type agreement and format markers/structure before saving. It does not perform full malware scanning, OCR or report interpretation.

For a future authorized processor, fetch bytes only on the server for one permitted submission, verify their SHA-256 against the metadata, and avoid logging bytes or embedding them in error traces. A future browser download should be authenticated, scope the request to the doctor's permitted case, and use an attachment response or a controlled viewer. Do not expose a public file URL or raw database access.

## Immediate confirmation queue

`hackathon_email_outbox.submission_id` uniquely references the submission. `reference` equals its receipt. The submission and this entry commit in one transaction. Repeating the same request returns the same receipt and cannot create a second confirmation.

The outbox contains recipient email, first name, a report-presence flag and receipt reference. First name is supplied by new intake; historical entries may have no name and retain the renderer's generic greeting. It contains **no health answers, notes, filenames, report bytes or diagnostic recommendations**. The sender receives only those minimal fields. The visible email notice is **“Demo · Fictional health information”**; internal identifiers are unchanged.

| State | Meaning / next action |
|---|---|
| `queued` | Awaiting an allowed attempt. A blocked recipient stays queued with `sender_blocked`; a known rate limit gets a future `available_at`, honoring the provider delay up to one day. |
| `sending` | Claim was committed before contacting the provider. If interrupted, hold for reconciliation. |
| `sent` | Provider accepted the message; inbox delivery is not established. |
| `local` | Simulated locally; no external delivery. |
| `failed` | Provider rejected the attempt. Review before explicitly retrying. |
| `unknown` | Acceptance is uncertain. Check provider evidence before any retry. |

Do not reset `sending` or `unknown` automatically. There is no deployed background sender or recovery scheduler. Current external sending is restricted to `fborja@martinez-laredo.com`; participant-wide sending requires a separate decision. The founder acknowledgement is implemented, but the later doctor-approved testing-plan email is not.

## Proposed next integration

Keep each stage separately recorded rather than rewriting the intake or using its confirmation status as clinical approval:

1. **Case access:** add authenticated doctor accounts and explicit case authorization. Create a narrow server-side read service; it must filter `data_class='synthetic'` and unexpired submissions. Keep intake immutable.
2. **Processing:** add a separate job/result table linked by submission `id`. Record processing version, input hash, state and timestamps. Store extracted report observations and any generated draft separately from the source files. Only approved processors may receive the fictional case data.
3. **Doctor review:** store draft revisions, reviewer identity, approval time and the exact approved revision. An AI draft is not an approved plan. Model/processing failure must leave the case awaiting review.
4. **Final email:** introduce a separate delivery kind/table keyed to the approved revision, queued atomically with approval. The send operation must verify that approval is current. Reuse durable claim/deduplication behavior without repurposing the receipt-confirmation row.
5. **Retention:** expire the source, reports, processing results and review artifacts together under the event's retention rule. Deleting the source currently cascades only to its confirmation outbox; future tables need deliberate retention links. No automated purge exists yet.

These are integration requirements for the next step, not implemented features. Before the current revision, the local backend's eight unit and seven real PostgreSQL tests passed, and Azure storage, its restricted login and the staged hosted API were verified. The current revision’s separate verification is recorded in [the release record](RELEASE-2026-09-30.md#uae-arrival-revision). Doctor permissions and external clinical-email delivery also need their own implementation and verification.
