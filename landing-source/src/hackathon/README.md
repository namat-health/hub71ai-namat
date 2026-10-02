# Demo welcome journey

30 September 2026. The temporary journey is live at **https://namat.health/welcome/** and **https://start.namat.health/welcome** for **fictional health answers and fictional reports**. It reuses Namat's visual assets while keeping event storage and email delivery separate from the permanent waitlist journey. See the [release record](RELEASE-2026-09-30.md) for deployment, verification and retirement details.

The questionnaire and intake API now run on Azure App Service `namat-welcome-test-uaen-001` in UAE North. The `start` domain points directly to that app and has a valid managed TLS certificate. The main landing page at `namat.health/welcome/` remains on Vercel.

## Current revision — 30 September 2026

The approved revision uses the questionnaire headline **“Welcome to the UAE. Let’s take care of your health.”** and the visible badge **“Demo”**. It limits location choices to the seven Emirates, removes country, pregnancy and current-treatment questions, and adds **“Starting a new life in the UAE”** (`uae_move`) to the opening goals. That goal continues to the health-motivation questions. First name is now required for new submissions in both this demo and the permanent questionnaire.

This revision is published and verified. See [the Azure migration checks](RELEASE-2026-09-30.md#azure-hosting-migration) and [the questionnaire revision checks](RELEASE-2026-09-30.md#uae-arrival-revision); the earlier-release section below keeps its original evidence separate.

## Approved flow

1. **Landing:** `namat.health/welcome` uses the original hero film, welcome copy, healthspan section and biomarker explainer. Three “Get started” links lead to `https://start.namat.health/welcome`. The compact header has no home/menu links, care journey, FAQs or waitlist form.
2. **Questionnaire:** the separate model accepts all fictional age/sex groups. Location is Abu Dhabi, Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah or Fujairah. There are no country, pregnancy or current-treatment questions. The new UAE-move goal leads into motivations; curiosity alone retains its shorter branch. Answers do not establish eligibility for clinical care.
3. **Contact:** required first name and email, answer-review controls and an explicit confirmation that health answers/reports are fictional and demo emails are expected. The introduction explains that the first email confirms receipt, and the personalised diagnostic plan follows after the doctor has reviewed and approved it.
4. **Final bloodwork question:** “Have you had any blood work done in the past six months?” Selecting **No** submits immediately. Selecting **Yes** opens drag-and-drop/file selection, then **Submit questionnaire**. There is no additional review screen after bloodwork. One to three PDF/JPG/PNG reports are required for Yes, with **2 MiB combined**; No submits without reports.
5. **Saved confirmation:** the screen shows an opaque receipt after database success. A durable queue records one immediate confirmation email. The founder email acknowledges the questionnaire/reports and says a doctor is working through the diagnostic plan. Later doctor-approved recommendations are a separate integration.

## Current implementation

| Part | Location / state |
|---|---|
| Landing | [WelcomeLanding.astro](welcome/WelcomeLanding.astro), [content.ts](welcome/content.ts); wrapper at `src/pages/welcome.astro`. |
| Questionnaire | [Questionnaire.astro](welcome/Questionnaire.astro), [questionnaire.ts](welcome/questionnaire.ts), [shared model](welcome/questionnaire-model.mjs); wrapper at `src/pages/start/welcome.astro`. |
| Intake endpoint | `POST /api/hackathon`; [Azure server](server/azure-server.mjs), [HTTP adapter](server/http.mjs) and [API](server/api.mjs). GET exposes readiness only. The Vercel wrapper remains available in source for the earlier package. |
| Storage | [Two-table PostgreSQL migration](db/001_welcome_submissions.sql): submissions with binary reports, and a separate confirmation outbox. No object-storage service is required for the approved small fictional files. |
| Email | [Confirmation renderer/sender](server/confirmation-email.mjs), with [transactional queue and delivery claims](server/store.mjs). The public Azure demo sends confirmations to participant addresses, approved on 1 October 2026. Local and older fallback environments retain their existing restrictions. |
| Local environment | Separate local `namat_hackathon` database, migrated and ready. Private `.env.hackathon.local` holds local settings and is ignored by Git. |
| Cloud hosting | Azure serves `/welcome`, its referenced assets, `/api/hackathon` and the generic `/healthz` check. `/` redirects to `/welcome`. The Node 22 package bundles its PostgreSQL dependencies and contains no environment files. |
| Cloud database | Both event tables remain in existing Azure `namat_journey`. Azure uses dedicated role `namat_hackathon_runtime`; its original 41 setup/permission checks remain recorded. Current hosted submissions and outbox state were verified separately below. |

Thirteen exact outbound-IP database firewall rules have been prepared for the Azure apps. Borja explicitly asked to retain the broad `hackathon-vercel-20260930` rule until the hackathon ends to avoid disrupting Pedro's other database work. **The exact rules do not restrict network access while the broad rule remains.** Verified TLS, credentials and the runtime role's table permissions still apply.

The backend accepts only `dataClass:'synthetic'` with `fictionalConfirmed:true`. It uses parameterized SQL and verifies remote database TLS. It has no submitted-data retrieval endpoint. The receipt is a reference, not a login or download credential.

Answers, notes and report files are stored together in PostgreSQL for this bounded event. Contact details are separate columns. The tables assign 30-day expiry timestamps; automatic retention deletion is not deployed. This fictional-case schema is not approved for real medical records.

The model identifier remains `namat-hackathon-welcome-v1`. New submissions omit `country`, `pregnancy` and `treatment` answer keys and country notes. Previously saved fictional cases keep their original fields; historical first names may remain null. This revision does not rewrite old submissions or make the database name columns non-null. Consumers must account for both historical and current shapes under this version; see [Pedro's handoff](PEDRO-HANDOFF.md).

## Azure migration verification

- Twelve Azure adapter and deployment-package compatibility tests passed. The allowlisted ZIP includes the server, current intake modules, referenced static assets and bundled `pg` dependencies; extracting it and importing the server/driver required no dependency installation.
- [Forty-five checks on the Azure hostname](../../output/azure-welcome-verification-2026-09-30.json) passed. The deployed page/assets matched the package. Two fictional No/Yes cases were stored once each; Yes saved PDF, PNG and JPEG files. Exact retries reused their receipts, changed content returned 409, and blank names, removed fields, missing uploads and foreign origins were rejected. Read-only SQL confirmed the rows/files and blocked delivery to both `example.invalid` recipients.
- [Seven domain and certificate checks](../../output/azure-start-domain-2026-09-30.json) passed. Public DNS resolves to the Azure app, normal TLS validation succeeds, and `/healthz` and `/welcome` return HTTP 200.
- [Six public-domain owner checks](../../output/azure-public-welcome-verification-2026-09-30.json) passed. One fictional no-bloodwork submission with first name **Borja** was sent to `fborja@martinez-laredo.com`. The API returned 201 and `confirmationEmail:sent`; read-only SQL confirmed one saved row and one outbox attempt with a provider message ID at **21:55:48 Dubai time**. This proves Brevo accepted the email; mailbox delivery was not independently verified. No POST retry was performed.

Runtime secrets now belong in the Azure app settings. The main-site landing deployment remains on Vercel. Build the Azure ZIP with `node scripts/package-hackathon-azure.mjs` after refreshing the standalone page package; its entrypoint is `npm start` → `src/hackathon/server/azure-server.mjs`. The [package manifest](../../output/hackathon-azure-manifest.json) records the included files and checksums.

## Earlier-release verification and handoff

The following checks were recorded before the UAE-only flow and required-name revision. They remain historical evidence for that release, not new verification claims for the revision.

- Eight backend unit tests and seven real PostgreSQL integration tests passed. The native tests used a temporary local schema, removed afterward, and synthetic email callbacks.
- The exact 2 MiB upload boundary, concurrent retries, atomic queue rollback, delivery deduplication, provider retry delays and uncertain provider outcomes were checked.
- The earlier landing review covered desktop and 390px layouts, video playback, all three links and horizontal overflow. The local form is available at `http://127.0.0.1:4332/start/welcome/` while the development server is running.
- Backend tests sent no external email. A separate approved owner confirmation was accepted by Brevo and reported delivered to `fborja@martinez-laredo.com`. Participant delivery was blocked for that earlier run.
- Azure setup preserved all nine journey-table counts and left both event tables empty. The restricted role passed a TLS login, exact grants and zero-row permission probes; see the [sanitized setup report](../../output/hackathon-azure-setup-2026-09-30.json). This is database verification, not a hosted submission test.
- The subsequent [staged hosted rehearsal](HOSTED-VERIFICATION-2026-09-30.md) passed 38 checks through the Vercel API and Azure: exactly two fictional cases, stable retry receipt, changed-request conflict, matching PNG bytes/digest and two confirmations blocked by the recipient policy. No provider accepted an email in that run.

Read [the API contract](server/README.md), [Pedro's integration handoff](PEDRO-HANDOFF.md), and [Azure setup and remaining publication steps](AZURE-PREPARATION.md).

## What remains separate

Both public domains and the landing-to-questionnaire link were verified for the earlier release. The current revision and Azure migration have their own release checks above. Model processing, report extraction, doctor accounts, a doctor portal, signed clinical approval and the later recommendation email are not implemented.

## Removal after the event

Handle the event records, reports, queue and credentials under the agreed retention policy, then remove the two welcome route wrappers, `api/hackathon.mjs`, this folder and the event-specific build wiring. Revoke the dedicated event login when retired. Keep shared assets, existing journey tables and the permanent questionnaire intact. Removing pages alone does not delete submitted data or provider/mailbox copies.

## UAE revision publication

The revised flow is live at https://start.namat.health/welcome on Azure. See [the release record](RELEASE-2026-09-30.md) for required-name validation, branching, hosted saves and domain migration. The later participant-email approval is recorded below.

## Participant confirmations — 1 October 2026

Borja approved confirmations for everyone submitting the public demo and a resend for his latest blocked Gmail submission. Only the public Azure app changed: `HACKATHON_EMAIL_MODE=participants` and `HACKATHON_PARTICIPANT_EMAIL_APPROVED=true`. Read-back confirmed all other app settings were preserved. Local configuration, the older Vercel fallback and protected permanent questionnaire were unchanged.

The existing receipt `509a7df4-b9aa-4b00-87c3-f99c79ab5669` was sent through the scoped outbox helper. Brevo accepted it at 10:05:29 Dubai time. No questionnaire was recreated and no other queued messages were replayed. Provider acceptance does not establish inbox delivery; the latest provider events are in [delivery evidence](../../output/participant-email-2026-10-01/delivery.json), alongside [configuration](../../output/participant-email-2026-10-01/configuration.json) and [resend evidence](../../output/participant-email-2026-10-01/resend.json).

Future deployments must preserve these live settings. Live submission checks now send external email: use read-only checks unless a recipient and send are approved. Local tests should continue using synthetic sender callbacks.
