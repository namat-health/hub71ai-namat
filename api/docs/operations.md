# Operating the demo API

## Live components

| Component | Repository | Azure app |
|---|---|---|
| Shared API | `namat-health/namat-api` | `namat-api-staging-uaen-001` |
| Questionnaire and current processing engine | `namat-health/start.namat.health` | `namat-welcome-test-uaen-001` |
| Signed-in doctor portal | `namat-health/doctor-portal` | `namat-doctor-test-uaen-001` |

All three apps use the existing Linux B1 plan in UAE North. This integration adds no compute plan, database or storage account. The marketing website and permanent waitlist journey have independent releases.

The API origin is `https://namat-api-staging-uaen-001.azurewebsites.net`. The questionnaire remains at `https://start.namat.health/welcome`. Microsoft authentication protects the doctor portal at `https://namat-doctor-test-uaen-001.azurewebsites.net`.

The portal's obsolete `DATABASE_URL` and `NAMAT_REPORT_REVIEW_TOKEN` settings were removed after activating its API adapter. Its data routes now require the portal API credential. A protected pre-release snapshot retains the old restricted settings for a deliberate rollback.

## Where data goes

The connected demo uses `/v1/demo/*`. Questionnaire records remain in `public.hackathon_welcome_submissions` in `namat_journey` on `namat-pg-test-uaen-001`. Related report, job and email tables retain their current references. Uploaded originals remain in private Azure Blob storage. The existing engine is responsible for storage, processing and sending confirmations, so there is one writer and one email outbox.

The API's earlier `/v1/submissions` interface uses a separate staging schema and does not send confirmations. Do not point a consumer at that interface expecting it to appear in the existing doctor portal.

The API currently delegates to the processing engine's authenticated internal routes. Moving that engine into this repository and deploying it separately is a later refactor; it must preserve case IDs, report links, processing state, receipt IDs and email idempotency.

## Release a change

1. Open a pull request. GitHub checks source syntax, contract types, database behavior against disposable PostgreSQL and the Linux deployment package.
2. Merge the reviewed change. A push to `main` runs verification but does not deploy.
3. In this repository's Actions tab, select **Namat API → Run workflow**, select `main`, and enable **Deploy the tested package to the existing Azure API app**.
4. That run verifies and packages its selected commit, then deploys the exact artifact. Azure login uses short-lived GitHub identity; its permission is restricted to the API app.
5. Check that both verification and deployment succeed. The final step checks liveness, denied anonymous access, authenticated database readiness and the published contract.

Never deploy the macOS dependency directory to Azure. The release workflow builds its artifact on Linux. Do not edit platform settings during a deployment unless the release requires an explicit configuration change.

## Verify the connected demo

`scripts/verify-demo-rollout.mjs` uses a private, permission-restricted settings bundle containing the three apps' settings. Its default mode performs read-only checks. Credentials must stay outside the repository.

Passing `--submit-fictional --wait-processing` creates exactly two fictional owner-test cases, one with a generated sample PDF. It saves request IDs and recovery state before making remote writes. Reuse the same private settings directory if a request times out; do not delete recovery state or generate new request IDs to retry a possibly successful submission.

`scripts/verify-demo-email-delivery.mjs` reads only those two cases' outbox records and their exact Brevo delivery events. It sends no messages. A database state of `sent` means the provider accepted the message; a matching `delivered` event is required to verify delivery to the recipient's mail server. It cannot establish inbox placement or that the recipient read the message.

Both scripts limit test confirmations to `fborja@martinez-laredo.com`. Their local evidence is saved under ignored `output/demo-rollout-2026-10-01/`. Recovery state, upload permissions and service credentials must never be copied into commits or issue comments.

Use the existing Microsoft-signed-in portal to verify the cases, questionnaire answers and original report preview. A direct API check does not replace this browser check.

## Failures and recovery

- A save timeout is an unknown outcome. Retry the same request ID and exact content. An HTTP 409 response requires investigation, not a fresh request ID.
- An API outage returns an error. Consumers never silently revert to direct database writes.
- A stored submission and its confirmation email are separate states. Check the outbox and provider delivery evidence before considering a resend.
- Keep private backups of previous settings and deployment packages. To roll back, deliberately disable a consumer's shared API flag and restore its previous package and restricted configuration. No case migration or deletion is needed.
- Never stop the shared App Service plan to roll back one app. Preserve Microsoft authentication, TLS, private storage and the allowed-user list.

Diagnostic-plan generation, per-case clinician permissions and approval to collect real patient data remain outside this fictional-demo release.

## First connected release: 1 October 2026

[GitHub release run 36882789655](https://github.com/namat-health/namat-api/actions/runs/36882789655) tested and deployed API commit `c577b4cb10ddb5033f12dbed20c884e797e2264f`. Verification, Linux packaging, federated Azure authentication, deployment and post-deployment checks all succeeded.

The hosted verification saved two fictional cases through the public questionnaire, confirmed same-request retries returned the original receipts, uploaded and processed a generated PDF, checked its exact original bytes and rejected a mismatched case/report request. Brevo recorded delivery of both owner confirmations, each with one send attempt. Microsoft-signed-in browser verification showed both cases and the report preview.

The consumer changes are recorded in [questionnaire PR 2](https://github.com/namat-health/start.namat.health/pull/2) and [doctor portal PR 4](https://github.com/namat-health/doctor-portal/pull/4). The API release fixed a duplicated response media type found during hosted verification; a real HTTP regression test protects this behavior.
