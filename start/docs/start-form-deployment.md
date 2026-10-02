# Deploying the start.namat.health form

## Source and release

The dedicated private repository `namat-health/start.namat.health` versions the form, confirmation emails, upload API and background report worker. The marketing website and doctor portal have separate repositories and deployments.

The 2 October 2026 foundations release is running on Azure App Service `namat-welcome-test-uaen-001` in resource group `namat-data-test-uaen`, UAE North. Its [release record](releases/start-2026-10-02-foundations.json) identifies the source, deployed archive, database migration and live checks. The form sends `namat-hackathon-welcome-v2`; the backend continues to accept saved or in-flight v1 forms.

The earlier [source-import record](releases/start-2026-10-01.json) establishes that all 22 runtime source files and all 231 image/font source assets match that archive byte for byte. The welcome page now builds from `src/pages/welcome.astro` in this dedicated repository. Its smaller page graph causes Vite to combine browser modules differently and generate new chunk names. A rebuilt ZIP is a new artifact with its own hash; the release record preserves the historical browser-file hashes for comparison. Creating this source repository does not redeploy the live app.

`git rev-parse HEAD` identifies the source for every future release. Keep that value, the generated package manifest and ZIP hash together in the release record. The packaging commands do not contact Azure. This repository's form CI tests and builds only; it does not deploy on push.

## Build and test from a fresh checkout

Use Node **22.19 or later in the Node 22 line**, npm, and the committed lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build
npm run verify
npm test
```

`npm run build` runs Astro and assembles `dist-hackathon/` with the welcome page, its referenced assets and application runtime. Private settings, database contents and uploaded reports stay outside the package.

The native PostgreSQL tests require an explicit disposable loopback database. Set `HACKATHON_TEST_DATABASE_URL` and `REPORT_TEST_DATABASE_URL` to its connection string before `npm test`. They create random schemas and remove them afterward. They refuse non-loopback hosts. Without those variables the integration tests are reported as skipped. `NAMAT_REPORT_SAMPLE_PATH` optionally tests a local C2PA PDF; no user-supplied report belongs in Git. Tests mock email/OCR providers.

For a working local form and reviewer, follow [the local preview instructions](../services/report-processing/README.md#local-preview). It uses a separate `namat_reports_dev` schema and local file storage, and forces local email mode.

## Database

The deployed database is `namat_journey` on `namat-pg-test-uaen-001`. Apply these migrations, in order, as an authorized schema owner when initializing a new environment:

1. [`001_welcome_submissions.sql`](../src/hackathon/db/001_welcome_submissions.sql): submissions and email outbox.
2. [`002_report_processing.sql`](../services/report-processing/db/002_report_processing.sql): sessions, original-file references, jobs, OCR page budget, immutable extractions and reviews.
3. [`003_questionnaire_v2.sql`](../src/hackathon/db/003_questionnaire_v2.sql): allow both v1 and v2 questionnaire versions. Apply before deploying the v2 form; it preserves existing submissions and permissions.
4. [`004_clinical_analysis.sql`](../services/clinical-analysis/db/004_clinical_analysis.sql): add immutable analysis/decision/inventory history and the shared spending ledger. Apply before deploying the clinical-analysis service routes. It adds narrow analysis grants when the existing `namat_hackathon_runtime` role is present.

Migrations 001–003 are already applied in the existing Azure environment. Migration 004 is a new release prerequisite and is not applied by code deployment. The creation migrations are not repeatable scripts; do not rerun them on existing tables. Record their SHA-256 checksums when applying them. The report foreign key is `namat_reports.submission_id → hackathon_welcome_submissions.id` with cascading metadata deletion. File bytes live in Blob storage; the database holds the private object key, original filename, MIME type, size and SHA-256.

Use the existing restricted login `namat_hackathon_runtime` for the form, not the database administrator. It has CONNECT and public-schema USAGE, no schema CREATE, ownership, role memberships or administrative role attributes. Its grants are:

| Table/function | Permissions |
| --- | --- |
| `hackathon_welcome_submissions` | SELECT, INSERT |
| `hackathon_email_outbox` | SELECT, INSERT; UPDATE only `status, claim_token, claimed_at, attempts, provider_message_id, last_error_code, sent_at, available_at` |
| `namat_report_sessions` | SELECT, INSERT; UPDATE only `id` for row locking |
| `namat_reports` | SELECT, INSERT, DELETE; UPDATE only `submission_id, blob_key, status, page_count, error_code, expires_at` |
| `namat_report_jobs` | SELECT, INSERT; UPDATE only `status, attempts, manual_retries, last_retry_at, last_failure_code, lease_token, lease_expires_at, available_at, error_code, completed_at` |
| `namat_report_ocr_budget` | SELECT, INSERT; UPDATE only `pages, updated_at` |
| `namat_report_extractions`, `namat_report_reviews` | SELECT, INSERT |
| `namat_report_cleanup_metadata()` | EXECUTE |

The fixed retention function is `SECURITY DEFINER` with a `pg_catalog` search path, qualified table names and PUBLIC execution revoked. The worker removes private files before report metadata and only then invokes this bounded cleanup. No grants on unrelated journey tables are needed.

Migration 004 additionally grants SELECT on the five analysis tables; INSERT on spend, runs, decisions and inventory reviews; UPDATE only on spend's `actual_micros,settled_at`; and row-lock privileges through `UPDATE(created_at)` on the budget and `UPDATE(id)` on submissions. It grants no deletion of spending records, budget-cap changes or history rewrites. See [the analysis service contract](../services/clinical-analysis/README.md) for expiry, stale-input checks and unknown-charge handling. Its native tests run both concurrency checks and a restricted-role permission check; CI supplies `ANALYSIS_TEST_DATABASE_URL` to avoid silently skipping them.

## Azure configuration

The existing app uses Linux x64, Node 22, its B1 plan and Always On. The server supervises one background worker on the same instance when reports are enabled. No additional worker host is required for this demo.

Set runtime secrets in Azure App Service configuration, or use Key Vault references. Never use `PUBLIC_` variables for secrets. Preserve the existing values during code deployments:

| Setting | Purpose/value |
| --- | --- |
| `HACKATHON_ENABLED` | `true` |
| `HACKATHON_DATABASE_URL` | Restricted runtime connection, with verified TLS |
| `HACKATHON_DATABASE_CA` | Optional custom CA, only if needed for TLS verification |
| `HACKATHON_ALLOWED_ORIGINS` | `https://start.namat.health,https://namat-welcome-test-uaen-001.azurewebsites.net` |
| `HACKATHON_EMAIL_MODE` | `participants` for the approved live demo; `local` for development; `owner-test` is the restricted owner test mode |
| `HACKATHON_PARTICIPANT_EMAIL_APPROVED` | `true` when participant delivery is enabled |
| `BREVO_API_KEY` | Private transactional email credential |
| `NAMAT_REPORTS_ENABLED` | `true` |
| `NAMAT_REPORT_STORAGE_ACCOUNT` | `namatreportstestuaen001` |
| `NAMAT_DOCUMENT_ENDPOINT` | `https://namat-reports-ocr-test-uaen-001.cognitiveservices.azure.com/` |
| `NAMAT_OCR_DAILY_PAGE_LIMIT` | `200` |
| `NAMAT_REPORT_REVIEW_TOKEN` | Generated private demo reviewer key, at least 32 characters |

Do not set `NAMAT_REPORT_LOCAL_DIRECTORY` in Azure. `PORT` is provided by App Service. Use the source's sender identity only with the matching verified Brevo sender. A response of `confirmationEmail: sent` records provider acceptance; it does not prove inbox delivery. The durable outbox preserves uncertain failures without claiming delivery.

### Storage and OCR permissions

The private account is `namatreportstestuaen001`, Standard LRS, Hot tier, with `quarantine` and `originals` containers. Require HTTPS/TLS 1.2; keep shared keys and anonymous access disabled. Blob CORS allows PUT only from the two origins above, with `content-type`, `x-ms-blob-type`, `x-ms-version` headers. Upload permissions last 15 minutes and permit creation of one generated quarantine object.

The app's managed identity needs:

- **Storage Blob Data Contributor** scoped to each of `quarantine` and `originals` separately.
- **Storage Blob Delegator** scoped to this storage account for user-delegation upload signing.
- **Cognitive Services User** scoped to `namat-reports-ocr-test-uaen-001`, the regional FormRecognizer S0 resource. Local OCR keys remain disabled.

The owner also has a separately approved **Storage Blob Data Reader** assignment scoped only to `originals`, added after the initial release on 1 October. This is for browsing/downloading in Azure; it grants no write/delete access. The application uses its managed identity independently of the owner's login.

Original reports and derived data expire within 30 days. Quarantine lifecycle deletion is set to one day; hourly application cleanup removes abandoned sessions and expired report data. Each OCR attempt reserves pages against the 200-page UTC-day application limit, including retries. These are the demo's existing settings, not an account-wide Azure spending cap.

## Package and deploy

On Linux x64 glibc, after the build above:

```sh
npm run package:azure
```

On macOS, stage the Linux dependencies in a fresh temporary directory first:

```sh
runtime_dir=$(mktemp -d)
node scripts/package-hackathon-azure.mjs --prepare-runtime "$runtime_dir"
npm ci --prefix "$runtime_dir" --os=linux --cpu=x64 --libc=glibc --ignore-scripts --no-audit --no-fund
NAMAT_RUNTIME_NODE_MODULES="$runtime_dir/node_modules" npm run package:azure
```

Outputs are `output/namat-hackathon-azure.zip` and `output/hackathon-azure-manifest.json`. The manifest lists every file hash. The packager validates locked dependency versions and Linux x64 native binaries and excludes environment files, source-control metadata and database records.

For an authorized release, preserve the prior ZIP and app settings privately, record the source commit and new ZIP hash, then deploy only this archive to the existing app:

```sh
az webapp deploy --resource-group namat-data-test-uaen \
  --name namat-welcome-test-uaen-001 \
  --type zip --src-path output/namat-hackathon-azure.zip
```

The app's startup is `npm start`, resolving to `node src/hackathon/server/azure-server.mjs`. Dependencies are bundled; keep remote build disabled. Confirm `/healthz` and `/welcome`, intake readiness, an authorized fictional upload and extraction, protected source viewing, and confirmation-outbox behavior. Do not publish secrets or participant data in release evidence.

## Shared Namat API migration

The Azure server supports an explicit compatibility mode. `NAMAT_SHARED_API_ENABLED=true` routes the existing browser intake and report endpoints through `https://namat-api-staging-uaen-001.azurewebsites.net/v1/demo`. The browser still uses same-origin URLs. `NAMAT_SHARED_API_INTAKE_TOKEN` is a server-only service credential; the browser's report-session or reviewer bearer remains separate.

The existing form backend remains the data owner during this migration. The API returns to exact allowlisted `/internal/namat/api/...` aliases with a distinct `NAMAT_SHARED_API_UPSTREAM_TOKEN`. Authentication is checked before the internal URL is mapped, and authenticated internal calls bypass proxying so requests cannot loop. Both secrets must be separate random 32-byte values encoded as 64 lowercase hexadecimal characters. Enabled configuration requires both; incomplete or reused credentials prevent startup. The upstream key can be installed while the switch remains off to verify the API before cutover.

Additional authenticated internal operations serve the portal: `GET /internal/namat/api/namat-portal/submissions`, `GET /internal/namat/api/namat-portal/submissions/{submissionId}/reports/{reportId}` (including `legacy-0` through `legacy-2`), `GET /internal/namat/api/namat-portal/submissions/{submissionId}/reports/{reportId}/extraction`, and `GET /internal/namat/api/namat-portal/ready`. Public `/api/namat-portal` routes return 404. Original-file responses check the exact active synthetic submission binding, size, type and SHA-256, and return `X-Namat-Content-Sha256` for the API and portal to verify. The extraction read applies the same binding and returns `{report:{id,status,pageCount},extraction}`: the latest draft's observations (name, value, unit, reference range, date, page, source text and bounds), warnings and each page's coordinate unit (`pt` for native PDF text, `inch` or `pixel` for OCR), or `extraction: null` while processing. It also returns the latest review of that draft (`review`, or null) and the report's current review revision (`reviewRevision`). Page text and older reviews are not returned; legacy attachments have no extraction. `POST /internal/namat/api/namat-portal/submissions/{submissionId}/reports/{reportId}/reviews` takes JSON `{extractionId,expectedReviewRevision,observations,actor}` from the doctor portal and saves it, after the same binding check, as the next `corrected` review through the existing review store, which rejects a stale draft or revision with 409. Observations may carry `confirmed: true` for values a doctor explicitly checked. No database schema or clinical-plan behavior changes.

Clinical analysis adds `GET /internal/namat/api/namat-portal/submissions/{submissionId}/reports/{reportId}/evidence-v1` and `POST /internal/namat/api/namat-portal/analysis-store`. The versioned evidence response includes bounded source-page text, literal observations, date provenance and current doctor corrections without changing the existing extraction contract. The store accepts only the fixed operations described in [its service contract](../services/clinical-analysis/README.md), with the same internal service authentication and active fictional-case binding. It makes no model requests. Apply migration 004, deploy and verify these source routes, then release the shared API bridge, and finally enable the portal analysis feature after its own verification. A portal release alone cannot create these tables or routes.

Deploy the compatibility code with the switch off and upstream key installed first. Verify internal authorization, readiness and API forwarding; then enable the form switch. Forwarding uses a fixed destination, bounded request/response sizes and no redirects, retries or fallback writes. Existing jobs, original files and confirmation outbox continue on their current backend. Switching `NAMAT_SHARED_API_ENABLED=false` restores direct public form handling without moving or deleting records. Remove the upstream key when retiring the bridge, after its callers have migrated.

## Code rollback

Restore a previously verified ZIP and its compatible settings. If disabling report processing, set `NAMAT_REPORTS_ENABLED=false` and restart; this also pauses the worker's application retention cleanup. Preserve database tables, originals and queued jobs for investigation. Arrange bounded retention cleanup if processing stays disabled. Do not drop data or rotate credentials as part of an ordinary code rollback.
