# Fictional report processing

The report-upload-v1 workflow in the dedicated private `namat-health/start.namat.health` repository shares the form's intake submission and receipt. It adds private originals, durable jobs, immutable extractions and explicit reviewer decisions. It does not generate diagnoses, diagnostic plans or patient-facing clinical advice.

## Flow

1. The questionnaire creates a 24-hour upload session. Only the hash of its random bearer token is stored.
2. Upload metadata reserves a report ID. A 15-minute Azure user-delegation SAS grants creation of that single quarantine blob. It grants no read, list, delete or overwrite permission.
3. Completion downloads the checked ETag, verifies actual size and SHA-256, then structurally inspects the file in a bounded worker. Supported C2PA provenance metadata is accepted; its authenticity is not asserted.
4. The service copies the verified bytes to a service-controlled original key. The browser has no access to this container. Only then does the report become eligible for submission.
5. Submission commits the report links, processing jobs and email outbox in one PostgreSQL transaction. Repeated requests with the same content retain their receipt.
6. A supervised worker claims a five-minute lease. It first reads native PDF text; images/scans use Azure Document Intelligence Layout. Up to three attempts recover transient failures. Failed reports allow at most three explicit reviewer retry cycles.
7. Common lab rows become drafts, retaining value strings such as `<5`, units, printed ranges, explicit dates and source pages. Unrecognised rows are not guessed. A reviewer can add missing observations, save corrections and approve the exact current revision.

`ready` means extraction finished. It does not mean the values were approved. The reviewer interface uses a private operator key for this fictional demo; named staff identity, assignment checks and MFA remain work for a real clinical service.

## Limits and retention

- Three reports per session; 10 MiB and 50 PDF pages per report.
- Images: at most 25 million pixels and 16,384 pixels per dimension.
- Parser worker: 30-second deadline and 256 MiB old-generation heap limit. This is format/content inspection, not antivirus scanning.
- At most 200 OCR pages per UTC day across workers, including retry reservations. Native text extraction makes no OCR request.
- Uploaded-but-unsubmitted records expire with their session. Azure quarantine lifecycle deletes abandoned blobs after one day; SAS itself cannot enforce a byte-size cap before upload.
- Submitted originals and derived records expire within 30 days. Hourly cleanup removes blobs before deleting metadata. Azure database backup retention is separate from active-record deletion.
- Existing binary attachments remain in their original rows. The optional backfill verifies and copies them; it does not remove legacy bytes or resend confirmations.

## Modules and access

`service.mjs` implements the HTTP contract, `blob.mjs` Azure storage, `document*.mjs` structural inspection, `ocr.mjs` regional OCR, `extract.mjs` conservative lab-row extraction, `store.mjs` transactions and leases, and `worker.mjs` processing/retention. The main Azure server supervises a separate worker process only when `NAMAT_REPORTS_ENABLED=true`.

The questionnaire and Pedro's interface can use the same operations and records. The existing `/api/hackathon` base64 interface remains available with its previous 2 MiB aggregate limit. The new reference-based workflow has a separate contract below.

### HTTP contract: report-upload-v1

All mutation requests require an explicitly allowed `Origin`. Session and reviewer bearer tokens are different credentials. Receipt IDs grant no read access. JSON errors include `message` and, where applicable, `code`; 401 means expired/missing credentials, 409 a conflict, 429 a temporary limit, and 503 unavailable storage.

| Operation | Request | Response |
|---|---|---|
| `POST /api/reports/sessions` | `{}` | `{sessionId,token}` |
| `POST /api/reports/uploads` | Session bearer + `X-Report-Session`; `{name,type,size,sha256}` | `{reportId,status,uploadUrl}`; exact metadata repeats reuse the ID |
| `PUT uploadUrl` | Raw file, `Content-Type`, `x-ms-blob-type: BlockBlob` | Azure 201; a repeated 409/412 must proceed to verified completion |
| `POST /api/reports/uploads/{id}/complete` | Session headers; `{}` | `{reportId,status}`; repeat-safe |
| `POST /api/hackathon` | Existing fictional intake, `reports:[]`, `reportIds`, `reportSession:{id,token}` | Existing `{status:'saved',receiptId,confirmationEmail}` |
| `GET /api/reports/cases` | Reviewer bearer | `{cases:[{id,receiptId,firstName,createdAt,reportCount,readyCount}]}`; latest 50 |
| `GET /api/reports/cases/{id}` | Reviewer bearer | `{case,reports}` with latest extraction and immutable review history |
| `GET /api/reports/{id}/source` | Reviewer bearer | Original file bytes; no public download URL |
| `POST /api/reports/{id}/reviews` | Reviewer bearer; `{extractionId,expectedReviewRevision,observations,decision}` | `{review}`; decision `corrected`, `approved` or `needs_changes`; stale revisions fail 409 |
| `POST /api/reports/{id}/retry` | Reviewer bearer; `{}` | `{report}`; failed/unexpired reports only |

Observation fields are `name`, `value`, `unit`, `referenceRange`, `date`, `page` and `sourceText`. Text values remain strings or null; page is a valid source page number. A review may also mark an observation `confirmed: true` when a doctor explicitly checked that value; any other value for `confirmed` is rejected. The immutable extraction also retains bounds and date provenance where available. Approval cannot silently modify the current values: save corrections first.

## Local preview

From the repository root, install and build the form with Node 22.19 or later in the Node 22 line:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run verify
```

Use an explicit loopback database and private settings file with `HACKATHON_DATABASE_URL`, `NAMAT_REPORT_LOCAL_DIRECTORY`, `NAMAT_REPORT_REVIEW_TOKEN` (at least 32 characters), and optional `PORT` (4350). Do not put secrets in source or browser bundles.

```sh
node --env-file=/private/path/preview.env services/report-processing/dev.mjs --init
node --env-file=/private/path/preview.env services/report-processing/dev.mjs
```

Initialization creates only `namat_reports_dev`, separate from existing local records. The preview forces local email mode and local file storage. PDF text extraction works locally; scan OCR requires the configured regional service. The browser opens `/welcome` and `/review`; the reviewer enters the private key. `scripts/seed-report-preview.mjs` creates a clearly fictional lab fixture through the real local upload API.

Run `npm test` for the repository tests. The [deployment guide](../../docs/start-form-deployment.md#build-and-test-from-a-fresh-checkout) describes the disposable database settings needed for integration tests.

## Cloud release status

The cloud pipeline is enabled for the fictional-data demo at `https://start.namat.health/welcome`. PDF, PNG and JPEG uploads, private originals, native text extraction and actual regional OCR have passed live checks. See [the deployment guide](../../docs/start-form-deployment.md) for the resources, roles, migrations, OCR page limit and release record. The previous PDF-only package remains available for rollback.

The [original live release record](../../docs/releases/start-2026-10-01.json) preserves the runtime and asset checksums. This dedicated repository rebuilds the browser files with different chunk names and composition. Use `npm run package:azure` following the deployment guide to create a new release archive. CI builds and tests without deploying, and credentials and private reports stay outside Git.

The report validation revision is `structured-documents-2026-10-01`. The existing questionnaire revision is unchanged because its answers and legacy payload contract are unchanged.
