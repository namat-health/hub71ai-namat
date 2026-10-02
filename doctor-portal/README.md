# Namat Doctor Portal

The patient review screen. For each new submission it shows the original lab report, what Namat read from it, a short patient summary with the full questionnaire one click away, and a personalised plan to review, approve and send. New patients wait in the review queue on the left.

## Patient review screen

- **Lab report.** The original PDF or image, one page at a time, fitted to the card. pdf.js renders it in the browser only (it is loaded with `ssr: false`, so the server bundle and its package aliases are unchanged). Zoom steps from 60% to 240%; download returns the original with its filename.
- **What Namat read.** The report engine's latest parser draft for each stored report, from `GET /api/submissions/{id}/reports/{reportId}/extraction`. Values, units and ranges stay as printed; Low/High compares a value only with the range printed beside it. Readings the doctor should confirm carry a short note (no unit printed, a decimal comma, far outside the printed range, or the same test printed twice with different values). Clicking a value opens its page and highlights the printed line using the parser's bounds. Reports still processing are checked again for two minutes; older attachments stored in PostgreSQL have no parser draft.
- **Confirming values.** Each flagged value offers **Looks right** (keeps the reading, making an inferred unit explicit) or **Fix** (the doctor's value, unit and range replace it). `POST /api/submissions/{id}/reports/{reportId}/confirmations` re-reads the current values, refuses a stale view with 409, and saves the full list through the report engine as the next immutable review revision, marking checked values `confirmed: true` and recording the signed-in doctor as its author. The screen then shows the reviewed values, with checked ones marked ✓. A review saved on the operator review page counts as checking every value. Saving needs shared-API mode; database mode can read reviews but not save them.
- **Questionnaire.** Answers to `namat-hackathon-welcome-v1` appear with doctor-facing labels from `lib/questionnaire.mjs`, never raw keys.
- **Plan.** See below. Evidence chips link a finding to its lab value in the report or its questionnaire answer.

The signed-in Microsoft user's display name appears in the rail and as the sender in the email preview; it is for display only.

## Plan generation

`POST /api/submissions/{id}/plan` returns `{plan, source}`. The plan contract and its validator are in `lib/plan.mjs`: `summaryShort`, `summaryLong`, `findings` (title, `severity` `act`/`monitor`, key values, short and long reasons, evidence by lab ID or questionnaire key), `tests` (`group` `now`, pre-selected, or `consider`; reason, inclusions, preparation, `locationType` `lab`/`clinic`), `followUps` and `sources`. The route builds the generator's input on the server from the active submission (questionnaire version, answers, notes and lab values as reviewed; no name or email) and rejects output that does not match the contract. It refuses with 409 `values_to_confirm` while any flagged value is unchecked; the plan button then names the value and opens it.

The foundation release deliberately leaves `generatePlan` in `lib/plan-generator.mjs` disconnected. It returns `analysis_not_connected` through the route; a patient can no longer receive the design fixture as a personalised plan. The fixture lives separately for contract tests.

### Tomorrow’s analysis connection

`GET /api/submissions/{id}/analysis-context` assembles the current case on the server. `planResponse` passes the same `caseContext` into `generatePlan` after report readiness and value-confirmation checks. Names and email fields are omitted; parsed report text and free-text answers can still contain identifying text and are untrusted evidence.

- `lib/clinical/case-context.mjs`: questionnaire facts and unknowns; raw parsed pages; original excerpts; reviewed values; report, extraction, page and review references; a fingerprint that changes when evidence changes. The fasting convention is an explicit assumption. Old age bands never become invented exact ages.
- `lib/clinical/knowledge-base.json`: clinical-only export from `namat-clinical-kb-v0.2.json`, with 81 markers, 44 screening records, 376 addressable claims and 184 source links. Source attribution is inherited at record level, not a new verification of each sentence. `scripts/build-clinical-knowledge.mjs source.json output.json` rebuilds it and records the source SHA-256.
- `lib/clinical/knowledge.mjs`: selects reference records for observed markers, explicitly referenced panels and selected questionnaire options. New medicines, tobacco and alcohol answers are evidence, without invented rules. Retrieved tests are not automatically recommended. The baseline bundle and complete catalogue remain available; `extendCaseKnowledge(context, ids)` retrieves and attaches additional marker or screening details with their claims and sources in batches of up to 20. Load full records before making recommendations about catalogue-only entries.
- `lib/clinical/analysis-contract.mjs`: strict output schema compatible with the new plan cards, plus citations, qualified explanations, missing information and reuse decisions. `validateGroundedAnalysis(result, caseContext)` rejects stale cases and invented references. It checks structure and provenance; the doctor still judges clinical correctness.
- `tests/fixtures/clinical-case.mjs` and `tests/clinical-foundations.mjs`: fictional input and checks for corrections, missing units/dates, older forms, source integrity and fabricated citations.

Tomorrow: call OpenAI from `generatePlan` with the case evidence and selected references; keep instructions outside that evidence; request `analysisSchema`; run `validateGroundedAnalysis`; return the validated plan and retain its grounding. Handle refusal and incomplete output before validation. Do not treat source text as instructions. The existing parser remains the PDF/OCR path. Qualified diagnostic possibilities are allowed in doctor-facing output when clearly distinguished from observations and supported by citations. No patient communication is generated or sent by these foundation modules.

Not built yet: storing the approved plan, selected tests and sent status; resolving partner locations (the email preview shows placeholder locations); and the patient email itself. **Send** changes only what this browser shows and resets on reload.

## How reports load

The browser requests a same-origin source route for each attachment. The server checks the doctor's Microsoft identity, confirms that the report belongs to the selected submission, and retrieves the original from the private Namat report service. It verifies the content type, file size and SHA-256 before returning the bytes with private, no-store headers.

Blob storage stays private. The browser receives neither storage credentials nor the report-service credential. The existing Microsoft sign-in covers the report preview; there is no additional access-key screen.

This test workspace shows active, confirmed fictional submissions. Expired, rejected and unavailable files cannot be opened. Existing questionnaire attachments stored in PostgreSQL are also supported.

## Configuration

The canonical doctor address is `https://doctor.namat.health`. Set `NAMAT_PORTAL_CUSTOM_HOSTNAME=doctor.namat.health` after binding its DNS and TLS certificate and registering its Microsoft callback. The Azure hostname remains available, with the same tenant, user and same-origin restrictions.


Copy `.env.example` to `.env.local` for local checks. Deployment secrets belong in Azure App Service settings.

- `DATABASE_URL`: the existing restricted database connection, with TLS certificate verification.
- `NAMAT_REPORT_REVIEW_TOKEN`: server-only credential for `https://start.namat.health/api/reports/:id/source`.
- `NAMAT_PORTAL_AUTH_MODE=azure-easy-auth`.
- `NAMAT_PORTAL_TENANT_ID`: the Microsoft tenant UUID.
- `NAMAT_PORTAL_ALLOWED_USER_IDS`: comma-separated Microsoft user object IDs allowed to view this workspace.
- `OPENAI_API_KEY`: optional, for the separate `/api/analyze` endpoint. The AI Lab Review page is no longer in the navigation.

### Shared API mode

Set `NAMAT_SHARED_API_ENABLED=true`, `NAMAT_SHARED_API_ORIGIN=https://namat-api-staging-uaen-001.azurewebsites.net` and the private `NAMAT_SHARED_API_PORTAL_TOKEN` to route the existing submission list, report source, parser draft and health endpoints through the shared Namat API. The parser draft and confirmations need the API's `GET /v1/demo/submissions/{id}/reports/{reportId}/extraction` and `POST /v1/demo/submissions/{id}/reports/{reportId}/reviews`, and the report engine's matching internal routes; until both are deployed, "What Namat read" reports that it couldn't load. Microsoft sign-in and the same tenant/user allowlist still apply before every request. The browser retains its existing same-origin URLs and never receives the service credential.

In this mode `DATABASE_URL` and `NAMAT_REPORT_REVIEW_TOKEN` are not required by these endpoints. Errors never fall back to direct database access. The API checks each report's submission binding; the portal also checks its type, size, original SHA-256 and file signature before returning private, no-store bytes. Parser drafts must match the expected shape exactly. Requests use a fixed HTTPS destination, refuse redirects, and have a 25-second total deadline. List responses are bounded to 2 MiB, parser drafts to 4 MiB; reports remain limited to 10 MiB. In database mode, the draft is read from `public.namat_report_extractions`, which the restricted login must be able to select.

The switch defaults off. Leaving it unset or setting it to `false` preserves the existing database/report-service path for a deliberate rollback. Keep legacy credentials privately available for rollback until the shared API release is verified; never substitute a browser-facing `NEXT_PUBLIC_` setting for either token. The independent `/api/analyze` endpoint is unchanged and does not generate clinical plans.

The Azure deployment must enable App Service Authentication, require authentication on every path, use Microsoft as the sole provider, and restrict access to the same allowed users. Azure supplies the trusted identity headers and its runtime markers. Direct local requests and incomplete authentication configuration fail closed; do not simulate trusted headers on an internet-facing server.

## Development and checks

Use `npm ci`, `npm test`, `npm run lint` and `npm run build`. `npm run dev` serves the UI locally; protected patient APIs need the Azure identity boundary. Unit tests inject fictional identity claims and never access real reports. They cover the lab-value mapping, questionnaire labels, the plan contract and both new routes. The example PDF is in `data/example.pdf`.

`GET /api/db/health` is protected and reports whether PostgreSQL is reachable. `GET /api/submissions` returns attachment references without raw report bytes or storage keys.

## Azure release packaging

Deploy a production build from GitHub main with Linux x64 dependencies. Preserve the generated package aliases under `.next/node_modules`: materialize directory symlinks using the matching locked packages before creating a ZIP. Omitting these aliases prevents the database and PDF libraries from loading. Exclude `.env` files and all credentials. Keep the existing Microsoft authentication configuration enabled throughout deployment.
