# Namat Doctor Portal

The patient review screen. For each new submission it shows the original lab report, what Namat read from it, a short patient summary with the full questionnaire one click away, and a personalised plan to review and record a decision on. New patients wait in the review queue on the left.

## Patient review screen

- **Lab report.** The original PDF or image, one page at a time, fitted to the card. pdf.js renders it in the browser only (it is loaded with `ssr: false`, so the server bundle and its package aliases are unchanged). Zoom steps from 60% to 240%; download returns the original with its filename.
- **What Namat read.** The report engine's latest parser draft for each stored report, from `GET /api/submissions/{id}/reports/{reportId}/extraction`. Values, units and ranges stay as printed; Low/High compares a value only with the range printed beside it. Readings the doctor should confirm carry a short note (no unit printed, a decimal comma, far outside the printed range, or the same test printed twice with different values). Clicking a value opens its page and highlights the printed line using the parser's bounds. Reports still processing are checked again for two minutes; older attachments stored in PostgreSQL have no parser draft.
- **Confirming values.** Each flagged value offers **Looks right** (keeps the reading, making an inferred unit explicit) or **Fix** (the doctor's value, unit and range replace it). `POST /api/submissions/{id}/reports/{reportId}/confirmations` re-reads the current values, refuses a stale view with 409, and saves the full list through the report engine as the next immutable review revision, marking checked values `confirmed: true` and recording the signed-in doctor as its author. The screen then shows the reviewed values, with checked ones marked ✓. A review saved on the operator review page counts as checking every value. Saving needs shared-API mode; database mode can read reviews but not save them.
- **Questionnaire.** Answers to `namat-hackathon-welcome-v1` and `namat-hackathon-welcome-v2` appear with doctor-facing labels from `lib/questionnaire.mjs`, never raw keys.
- **Plan.** See below. Evidence chips link a finding to its lab value in the report or its questionnaire answer.

The signed-in Microsoft identity appears in the rail and is recorded as the author of clinical review decisions.

## Clinical interpretation

The interpretation engine is implemented and defaults to disabled until a funded OpenAI account is connected. Development uses fictional cases and injected provider doubles; no API credits are needed to run the tests. See [the implementation guide](docs/clinical-analysis.md) for setup, limits and the first funded evaluation.

`POST /api/submissions/{id}/plan` builds an analysis from the stored questionnaire and current report revisions. The server sends the complete original reports, questionnaire context and bounded knowledge base to OpenAI Responses. The model chooses patterns and proposes tests; code validates source references, coverage and ordering constraints, followed by a separate model evidence check against the same originals. Only a draft that passes both checks is saved. `GET` on the same path reloads an unexpired current draft and its latest clinician decision without calling OpenAI.

The response retains the plan, finding provenance, observation coverage, all considered test dispositions, questions, limitations, source records, versions and run fingerprint. Findings distinguish observations from possible explanations. Numbers come from the stored evidence. Reference links are inherited record-level citations, not a guarantee that a source supports every generated sentence. The knowledge base and rules remain unsigned clinical drafts.

The first rules cover lipids, glucose, blood count/iron, kidney, liver and thyroid. Other parsed observations are explicitly marked outside coverage. Missing dates, incomplete inventories and ambiguous readings remain visible. No fasting, pregnancy, bleeding or chronicity assumptions are fabricated. Collection dates are distinct from report dates, and original readings are retained separately from clinician corrections.

`POST /api/submissions/{id}/report-inventory` lets a clinician attest that every test row in a particular report is accounted for in the extracted list. This binds an extraction and review revision; a correction invalidates the attestation. Until confirmed, missing-marker proposals are deferred because parser omissions are not proof a test is absent. Existing-result interpretation is still available.

All test selections start empty. `POST /api/submissions/{id}/analysis-decisions` saves approval, rejection or changes requested with the authenticated clinician, selected tests and notes. The storage owner checks the current questionnaire and report revisions under database locks. No action sends a patient message or places a laboratory order. The old unbudgeted `/api/analyze` prototype returns 410.

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
- `OPENAI_API_KEY`: server-only funded project key, when available.
- `NAMAT_ANALYSIS_ENABLED=true`: explicit opt-in after storage and the funded account are ready. Defaults disabled.
- `NAMAT_ANALYSIS_MODEL=gpt-6.1-sol`: configured model; `gpt-6-astra` is also priced in the allowlist.

### Shared API mode

Set `NAMAT_SHARED_API_ENABLED=true`, `NAMAT_SHARED_API_ORIGIN=https://namat-api-staging-uaen-001.azurewebsites.net` and the private `NAMAT_SHARED_API_PORTAL_TOKEN` to route the existing submission list, report source, parser draft and health endpoints through the shared Namat API. The parser draft and confirmations need the API's `GET /v1/demo/submissions/{id}/reports/{reportId}/extraction` and `POST /v1/demo/submissions/{id}/reports/{reportId}/reviews`, and the report engine's matching internal routes; until both are deployed, "What Namat read" reports that it couldn't load. Microsoft sign-in and the same tenant/user allowlist still apply before every request. The browser retains its existing same-origin URLs and never receives the service credential.

In this mode `DATABASE_URL` and `NAMAT_REPORT_REVIEW_TOKEN` are not required by these endpoints. Errors never fall back to direct database access. The API checks each report's submission binding; the portal also checks its type, size, original SHA-256 and file signature before returning private, no-store bytes. Parser drafts must match the expected shape exactly. Requests use a fixed HTTPS destination, refuse redirects, and have a 25-second total deadline. List responses are bounded to 2 MiB, parser drafts to 4 MiB; reports remain limited to 10 MiB. In database mode, the draft is read from `public.namat_report_extractions`, which the restricted login must be able to select.

The switch defaults off. Leaving it unset or setting it to `false` preserves the existing database/report-service path for a deliberate rollback. Keep legacy credentials privately available for rollback until the shared API release is verified; never substitute a browser-facing `NEXT_PUBLIC_` setting for either token. Clinical generation and decisions require shared API mode; they never fall back to direct database writes.

The Azure deployment must enable App Service Authentication, require authentication on every path, use Microsoft as the sole provider, and restrict access to the same allowed users. Azure supplies the trusted identity headers and its runtime markers. Direct local requests and incomplete authentication configuration fail closed; do not simulate trusted headers on an internet-facing server.

## Development and checks

Use `npm ci`, `npm test`, `npm run lint` and `npm run build`. `npm run dev` serves the UI locally; protected patient APIs need the Azure identity boundary. Unit tests inject fictional identity claims and never access real reports. They cover the lab-value mapping, questionnaire labels, the plan contract and both new routes. The example PDF is in `data/example.pdf`.

`GET /api/db/health` is protected and reports whether PostgreSQL is reachable. `GET /api/submissions` returns attachment references without raw report bytes or storage keys.

## Azure release packaging

Deploy a production build from GitHub main with Linux x64 dependencies. Preserve the generated package aliases under `.next/node_modules`: materialize directory symlinks using the matching locked packages before creating a ZIP. Omitting these aliases prevents the database and PDF libraries from loading. Exclude `.env` files and all credentials. Keep the existing Microsoft authentication configuration enabled throughout deployment.
