# Demo API integration

## Routes

Every route requires `X-Namat-Service-Key` from a trusted application server. The intake and portal keys are distinct. Browser credentials such as the report upload session remain separate and are still checked by the report engine.

| Shared route | Caller | Contract |
|---|---|---|
| `GET/POST/OPTIONS /v1/demo/intake` | Questionnaire server | Existing `/api/hackathon` contract, including `reportIds` and `reportSession`; same receipt and confirmation state |
| `POST /v1/demo/reports/sessions` | Questionnaire server | Create upload session |
| `POST /v1/demo/reports/uploads` | Questionnaire server | Reserve private report and create-only signed upload |
| `POST /v1/demo/reports/uploads/{id}/complete` | Questionnaire server | Verify completed upload |
| `GET /v1/demo/reports/cases[/{id}]` | Existing review server | Existing reviewer token also required |
| `GET /v1/demo/reports/{id}/source` | Existing review server | Existing reviewer token also required |
| `POST /v1/demo/reports/{id}/reviews` or `/retry` | Existing review server | Existing reviewer token and revision checks remain required |
| `GET /v1/demo/ready` | Doctor portal server | `{status:"ready"}` or HTTP 503 |
| `GET /v1/demo/submissions` | Doctor portal server | Existing `{submissions:[...]}` shape; active fictional cases only |
| `GET /v1/demo/submissions/{id}/reports/{reference}` | Doctor portal server | Bound original bytes with type, length and `X-Namat-Content-Sha256`; reference is a report UUID or `legacy-0..2` |
| `GET /v1/demo/submissions/{id}/reports/{reportId}/extraction` | Doctor portal server | `{report:{id,status,pageCount},extraction,review,reviewRevision}` for that bound stored report: the latest parser draft's observations, warnings and page coordinate units (or `extraction:null` while processing), the latest review of that draft and the report's review revision. No page text or older reviews; legacy references are not accepted |
| `POST /v1/demo/submissions/{id}/reports/{reportId}/reviews` | Doctor portal server | JSON `{extractionId,expectedReviewRevision,observations,actor}`; saved as the next `corrected` review of that bound report. Observations may mark doctor-checked values `confirmed: true`. A stale draft or revision returns 409 |
| `GET /v1/demo/submissions/{id}/reports/{reportId}/evidence-v1` | Doctor portal server | Versioned bounded source pages, literal observations, original date provenance and current corrections for clinical analysis; does not change the existing extraction response |
| `POST /v1/demo/analysis-store` | Doctor portal server | Fixed `{operation,input}` commands for shared spend reservations, immutable analysis runs, inventory confirmations and clinician decisions. The existing report service owns persistence; this bridge neither calls a model nor creates a second database writer |

Report limits remain three PDF/PNG/JPEG files, at most 10 MiB and 50 PDF pages per file. Upload bytes go directly to a private Azure object using narrowly scoped permission; the API controls the session, reservation and acceptance. Intake JSON is limited to 4,000,000 bytes. Report responses are bounded; redirects are refused.

The bridge forwards each request once. A timeout does not prove a save failed: retry the same request ID and content. HTTP 409 conflict and 429 rate-limit responses are preserved. No automatic fresh-ID retry, mirrored save or legacy fallback is permitted.

## Deployment sequence

1. Install the questionnaire engine's authenticated internal routes with public forwarding disabled. Its worker and original data stay in place.
2. Deploy the API bridge, configured for that exact engine and three distinct server credentials. Verify scope separation, upload completion, same-ID retry, case reads and original bytes.
3. Enable the questionnaire's server adapter. Test fictional submissions using the approved owner recipient and verify confirmation delivery separately from storage.
4. Enable the doctor portal adapter, preserving Microsoft sign-in. Verify the cases and files appear through its existing routes. Its shared-API mode must work with no database credential and must not fall back to direct SQL.
5. Preserve the previous packages and record the final deployed revisions. Confirm public health, report processing and recovery after switching.

The private engine routes use `/internal/namat` plus an allowlisted existing path and require `X-Namat-Upstream-Key`. They bypass the public proxy only after authentication, preventing a routing loop. They grant neither schema administration nor a new database login. The engine's restricted runtime remains the sole data owner during this phase.

## Configuration

API: `NAMAT_API_DEMO_ENABLED=true`, exact `NAMAT_DEMO_UPSTREAM_ORIGIN`, `NAMAT_DEMO_INTAKE_TOKEN`, `NAMAT_DEMO_PORTAL_TOKEN`, `NAMAT_DEMO_UPSTREAM_TOKEN`. These extend the existing staging configuration without changing its isolated database credentials.

Questionnaire: `NAMAT_SHARED_API_ENABLED=true`, `NAMAT_SHARED_API_INTAKE_TOKEN`, `NAMAT_SHARED_API_UPSTREAM_TOKEN`. The adapter fixes the API origin in server code. The upstream token can be installed first with forwarding disabled.

Portal: `NAMAT_SHARED_API_ENABLED=true`, fixed `NAMAT_SHARED_API_ORIGIN`, `NAMAT_SHARED_API_PORTAL_TOKEN`. Its Microsoft tenant/user allowlist remains unchanged.

All tokens are random 32-byte secrets encoded as 64 lowercase hexadecimal characters. No application setting value belongs in Git, deployment artifacts, screenshots or logs.

## Rollback

Disable each consumer's shared-API flag and restore its previous package/settings. The original cases, receipt IDs, report links, jobs and email records remain with the same engine, so rollback does not require copying or deleting data. If restoring direct portal reads, restore only its previous restricted database configuration. Never stop the shared B1 plan to roll back one app.

Physical extraction of the engine/worker into the API process is a later internal refactor against the same interface. Named per-case authorization, diagnostic plans and real-patient release require their own explicit implementation and verification.
