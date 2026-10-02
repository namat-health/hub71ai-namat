# Clinical interpretation implementation

The doctor's **Analyse** button produces a source-linked clinical draft from the questionnaire, the complete original reports, and Namat's preventive-health knowledge base. The model identifies patterns and proposes explanations and tests. Code checks the evidence references and applies ordering constraints afterwards. This release is restricted to the existing fictional demo environment.

## What the doctor receives

- A short case synthesis and prioritized findings, with observations distinguished from possible explanations.
- Supporting and contradictory evidence, links to the exact report page or questionnaire answer, applicable KB claims, and unresolved questions.
- Proposed tests with the question each would help resolve. Already available results, exclusions, consent requirements, uncertain readings and incomplete inventories remain visible in the action ledger.
- Per-observation and per-page coverage, plus safety alerts. Page coverage is the model's assessment; it is not a clinician attestation that the inventory is complete.
- A saved approval, rejection or request for changes tied to the exact questionnaire, extraction and correction revision reviewed. Tests start unselected. Approval records the doctor's decision; it does not send orders or patient messages.

## Request flow

1. Authenticate the Microsoft clinician and load the active, explicitly fictional submission. The browser supplies its ID, never a replacement clinical case.
2. Read the report service's `evidence-v1` contract: full text pages, literal readings, typed date provenance and clinician corrections. Unknown and unrecorded questionnaire answers remain explicit.
3. Check the saved-case cache. For a new analysis, fetch the complete PDF/PNG/JPEG originals through the existing authenticated fixed-origin source endpoint. Verify report binding, MIME, byte count, SHA-256 and page count. Limits are three files, 10 MiB each, and 50 pages each. Anonymous attachment filenames are used; originals stay in request memory.
4. Send the originals, full questionnaire context, all extracted observations and the bounded KB catalogue to OpenAI Responses. PDF inputs give the vision model both page imagery and text. The current KB is small enough to include its 81 marker and 44 screening records with all clinical claims and exclusions, avoiding retrieval that could hide a useful connection. The model input removes repeated bibliography IDs/URLs and duplicate baseline-policy tables; the full source attribution stays on the server and in the review output. Identical shared knowledge is sent first to support prompt caching. No embeddings or external search service is required.
5. The model chooses its own findings, supporting and contrary evidence, questions and proposed catalogue tests. Findings and proposals do **not** have to match the old six-domain pattern/candidate menu. Existing rules now supply safety alerts, known abnormal-result coverage and chronology boundaries.
6. Validate the structured result. Check every identifier, require every observation and original page to be accounted for, preserve required abnormal findings, reject invented numeric prose, and insert verified values in the interface. Exact report quotes are matched to extracted text. A quote seen only in an image or a partial text layer stays `visual_unconfirmed`; it needs source confirmation before a dependent test is selectable.
7. Apply test policy: known catalogue only, case evidence and claims required, scope/exclusions, consent/shared decision, existing results and reuse, readable evidence, and complete prior-result inventory. A proposal can be clinically interesting but remain deferred. A relevant test does not require a hard-coded trigger.
8. Send the same originals and case to a separate verification call. It checks the draft's factual premises, clinical claim support, polarity, contrary evidence, source quotes, missed salient findings, duplicate tests (including rows the parser missed), qualifications and recommendations hidden in prose. A well-formed rejection gets at most one correction pass with the critique and original case, followed by a fresh verification. Every call reserves and settles its own spend. Invalid structure, refusal, timeout, insufficient funds or a second rejection stops without saving the draft. This is a fallible model check, not an independent medical validation.
9. Save passing output, evidence references, model/prompt/schema/KB/policy versions, original hashes, usage and validation metadata in the existing report-service database. Never save original bytes/base64 in the analysis record. Reuse lasts at most 24 hours and cannot outlive the submission or a known time-based eligibility change.
10. Before saving the doctor's decision, reload the current case. Database locks reject stale questionnaire/report revisions. Corrections invalidate both prior analysis and any inventory attestation.

The parser remains useful for exact numeric chips and comparisons, but does not define everything the model can read or interpret. Failed/unready report processing, ambiguous structured readings and unresolved corrections still require source resolution before the current case gate permits analysis. The report-input loader can fetch a parser-failed original, but that alone does not bypass this gate. `report-normalizer.mjs` remains an unwired optional extraction contract.

## Code map

| Responsibility | File |
| --- | --- |
| Case and original/corrected provenance | `lib/clinical/case-context.mjs` |
| Full original inputs | `lib/clinical/report-inputs.mjs` |
| Safety and known observation coverage | `lib/clinical/rules.mjs` |
| Catalogue and source claims | `lib/clinical/knowledge.mjs`, `knowledge-base.json` |
| Free model interpretation contract | `lib/clinical/interpreter-contract.mjs` |
| Responses, token counting and prices | `lib/clinical/openai-provider.mjs` |
| Reference/coverage validation and presentation | `lib/clinical/interpretation-assembly.mjs` |
| Post-proposal ordering constraints | `lib/clinical/proposal-policy.mjs` |
| Semantic verifier and narrow language tripwires | `lib/clinical/narrative-check.mjs` |
| Budgeted orchestration and caching | `lib/clinical/interpreter.mjs` |
| Authenticated routes and fresh-case checks | `lib/portal-backend.mjs` |
| Durable runs, budget and decisions | `../start/services/clinical-analysis/` |

The knowledge base is a draft with record-level source attribution and unresolved clinical governance. The model may connect supported facts but cannot manufacture missing guideline support. The system does not calculate unsupported risk scores, establish diagnoses, prescribe treatment or automatically order tests. Doctor approval and software tests do not establish clinical validity.

## Activation and deployment

Deployment spans the report-service, shared API and portal repositories. Apply the additive `../start/services/clinical-analysis/db/004_clinical_analysis.sql` migration with the operations role after existing migrations. Its runtime-role grants are narrow. There are no request-time migrations; an existing database needs the migration applied explicitly.

Deploy the report-service evidence/store routes, then the shared API bridge, then the portal. Preserve Microsoft identity, the synthetic-data gate, fixed service origins and private storage. Analysis requires shared API mode and creates no second data owner.

Server-only portal configuration:

```dotenv
NAMAT_SHARED_API_ENABLED=true
NAMAT_SHARED_API_ORIGIN=https://namat-api-staging-uaen-001.azurewebsites.net
NAMAT_SHARED_API_PORTAL_TOKEN=<existing private service credential>
NAMAT_ANALYSIS_ENABLED=true
NAMAT_ANALYSIS_MODEL=gpt-6.1-sol
OPENAI_API_KEY=<funded API project key>
OPENAI_PROJECT_ID=<optional project routing ID>
OPENAI_ORG_ID=<optional organization routing ID>
```

Never use `NEXT_PUBLIC_` for these credentials. Keep `.env.local` out of Git. A funded ChatGPT workspace does not by itself verify funded API access. All model calls use `store:false`; this does not establish zero retention or regional residency. Original PDFs and free text may still contain identifying information despite excluding the direct contact fields. Real health-data use needs its own approved deployment and clinical validation.

## Spend control

One shared PostgreSQL ledger caps this feature at **$20** across workers. Migration 004 reserves **$5** for the local fictional evaluation allocation, leaving at most **$15** for production. The local runner uses a durable, exclusive-lock ledger in the Git-ignored `.clinical-evaluation/` directory. It refuses missing or damaged ledgers after explicit first initialization; never delete that directory to reset spending. The production reservation stays held until operations permanently closes and reconciles local evaluation. The Responses input-token endpoint counts the exact text, schema, files and images before inference. Requests above 120,000 input tokens (including headroom) are rejected. Each generation/verification request reserves the higher cache-write input price plus maximum output before dispatch, and then settles actual input/cache-read/cache-write/output usage. SDK retries are disabled; unknown outcomes retain their reservation for reconciliation. A test runner must use the shared ledger or the already reserved $5 allocation, never create a second $20 allowance.

Sol 6.1 currently uses Standard prices of $2 input, $0.10 cache read, $2.50 cache write, and $10 output per million tokens; the checked-in Astra option uses $10/$1/$12.50/$50. Both stages use low reasoning effort; clinical quality at that setting still needs clinician evaluation. Output limits are 6,000 for interpretation and 2,000 for verification. Full-context PDF cases cost more than the old extracted-row-only call. For illustration only, two calls each writing 85,000 input tokens to cache and producing 4,000 combined output tokens would cost $0.465 on Sol. A correction adds at most one more interpretation and verification pair. Actual token use, caching and reasoning vary. Recheck the [model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [file inputs](https://developers.openai.com/api/docs/guides/file-inputs), and [token counting](https://developers.openai.com/api/docs/guides/token-counting) before changing the provider.

## Evaluation

`npm test` is offline and uses explicitly labelled provider doubles. It tests original transport/binding, novel model-authored findings, catalogue proposals outside deterministic triggers, evidence/coverage rejection, source uncertainty, correction invalidation, API authentication, budget accounting and saved decisions. It does not measure real model clinical accuracy. Run `npm run lint` and `npm run build` as well.

The report-service's `clinical-analysis-postgres.test.mjs` runs only against an explicitly configured disposable loopback database. Native PostgreSQL tests cover concurrency, stale-case races, runtime-role privileges, immutability and retention. They have been exercised locally on a disposable database; live migration/deployment is separate.

To run the named fictional PDFs locally, use `node --env-file=.env.local scripts/evaluate-clinical-analysis.mjs --live iron_glycemia`. Use `--initialize-budget` only once before the first ever paid evaluation; reruns load the existing ledger. Named cases also include `medicine_context`, `recent_ferritin` and `critical_potassium`. Each run verifies that reopening the same result makes no further provider call, then retains its fictional PDF, raw model/verifier outputs, pass/fail state, elapsed time and spend under `.clinical-evaluation/results/`. A failed case stops the batch for inspection.

The remaining evaluation should exercise the actual authenticated portal endpoint and shared ledger: an iron/blood-count pattern with fatigue; medication/supplement context with a cross-domain finding; recent duplicate results; ambiguous units/dates; a scanned/mixed PDF with an uncaptured row; a report/query injection; and a critical result. Have a doctor adjudicate missed findings, unsupported claims, duplicate/low-value tests, source accuracy, and time to approve. Compare fixed held-out cases across prompt/model/KB versions. Record doctor edits as feedback, not automatic ground truth. Do not claim readiness from a handful of good demonstrations.

### Live fictional results, 2 October 2026

The CLI exercised the same interpretation engine with actual PDFs and real OpenAI calls. These are development observations, not clinical validation or a production portal smoke test.

| Case | Result | Calls | Time | Usage-derived cost |
| --- | --- | --- | --- | --- |
| Low haemoglobin/MCV, raised HbA1c, fatigue and biotin context | Passed after one correction; ferritin/glucose proposed, thyroid assessment deferred | 4 | 108 s | $0.862215 |
| Historical report with critical potassium flag | Passed; routine selection blocked, clinician verification retained | 2 | 32 s | $0.402743 |
| Medication context with a proton-pump inhibitor | Passed interpretation and independent verification | 2 | 47 s | $0.423308 |
| Recent ferritin already available | Passed without an unnecessary repeat ferritin proposal | 2 | 56 s | $0.425745 |

All four saved results reopened without fetching originals or calling OpenAI. Earlier iterations exposed ambiguous catalogue IDs, false-positive wording checks, stale inventory metadata, overlong rationales and unsupported repeat proposals; these were corrected or rejected. Compaction reduced the first synthesis input from approximately 134,000 to 79,000 tokens while preserving every clinical record field and claim text (covered by regression checks).

Total recorded local usage across development attempts was $3.002694. A separate $0.457708 remains reserved for the first timed-out request, including cache-write headroom; its charge has not been reconciled. Clinical adjudication, realistic mixed/scanned PDFs, wider held-out cases and authenticated deployed end-to-end testing remain outstanding.

## Local interface preview

`NAMAT_OFFLINE_PREVIEW=true npm run dev -- --hostname 127.0.0.1 --port 3107` opens the authored example at `http://127.0.0.1:3107/analysis-preview`. It has empty selections, disables saving and exists only in opted-in development. After a successful `iron_glycemia` CLI evaluation, it displays the saved OpenAI output from the ignored `.clinical-evaluation/preview.json`, explicitly labelled as a fictional saved AI result. With no valid evaluation artifact, it displays the clearly labelled authored example. Loading the preview never calls OpenAI and neither mode substitutes for an authenticated patient analysis.

## Fast demonstration mode (2 October 2026)

Set `NAMAT_ANALYSIS_MODE=demo` and `NAMAT_ANALYSIS_MODEL=gpt-6-luna` for the fictional hackathon demonstration. This sends the original reports, full questionnaire and results with relevant KB claims in one Responses call, using Fast mode and `reasoning.effort=none`. Compact evidence aliases resolve back to immutable server IDs; catalogue test IDs remain named to avoid ambiguity. Related KB records are included in one reference-expansion step.

The single-pass output is labelled as a demo draft. It retains schema, source-reference, quote, critical-result and test-eligibility checks, but skips the independent model critique and correction loop. `validation.narrativeCheck=not_run_demo` records this explicitly. Uncited observations are marked unassessed, never normal. Mode is part of cache identity. The original full mode remains the default when the setting is absent.

The AI request times out after 18 seconds without automatic retry. The browser request, including response-body reading, stops after 25 seconds with an actionable error. Unknown API outcomes retain their cost reservation. Reopening a valid saved result is free. The first passing Luna fixture took 3.916 seconds for inference and approximately five seconds for the complete local pipeline, with 5,114 input tokens, 548 output tokens and a $0.001827 estimated Fast-mode cost. This is a measured fictional example, not a latency guarantee or clinical validation.
