# Namat · Hub71+ AI Hackathon · 2 October 2026

Team **namat** · Track: **Move to, settle in and build a future in Abu Dhabi**

Namat helps newcomers bring their health history to Abu Dhabi. They answer a health questionnaire and upload previous blood tests. AI combines the questionnaire, original reports and a curated preventive-health knowledge base into a draft interpretation. A doctor reviews the evidence, selects follow-up tests and previews the results email with nearby blood-draw providers.

## Live demo and access

- **Start here:** https://namat.health/welcome — public landing page.
- **Questionnaire and report upload:** https://start.namat.health/welcome — public; use fictional demo details and reports.
- **Doctor review, AI interpretation and results email:** https://doctor.namat.health — Microsoft sign-in with an approved Namat staff account. Demonstrate using the team's existing signed-in session.

A three-minute journey: open the welcome page, show the questionnaire/report upload, then use an existing fictional submission in the doctor portal to generate and review the interpretation and preview the patient email. The live AI uses the fast GPT-6 Luna demo path, with doctor review before any results email is sent.

## Complete code inventory

<!-- sources:start -->
| Folder | Contents | Source revision |
| --- | --- | --- |
| `website/` | Complete deployed marketing website, redirects, Vercel configuration and shared assets | `8686a08f9276fe7b1f356e0ad0016a503ed5fdf7` |
| `welcome/` | Published welcome HTML/assets and original landing components retained from the initial submission | Website revision above; landing revision below |
| `landing-source/` | Complete Astro landing source, components, styles, assets, dependency lock and build scripts | `cdf4acacc6d98b225a748a42662c777d03e38762` |
| `start/` | Questionnaire, uploads, report parser/OCR worker, confirmation emails, shared persistence and clinical-analysis database migrations | `fd908a42d6123086c9d561ea36d672424aad5fd8` |
| `doctor-portal/` | Doctor UI, AI prompts and model calls, evidence checks, curated knowledge base, lab-provider dataset, results emails and spinner/email-preview fixes | `b99a80070725c9a04a0209c7053661ac02408ec5` |
| `api/` | Shared API, contracts, authorization bridge and clinical evidence/persistence endpoints | `036ded6ceeeb89dbe284361e92a506f3795c57de` |
| `patient-portal/` | Complete patient demo login/profile source, public-host redirects and deployed standalone build configuration | `1dab8c056291479e0d42477710d9202ff6792f62` plus recorded `next.config.mjs` packaging setting |
<!-- sources:end -->

Every component is copied into this repository, including its dependency lock, runtime source, assets, tests and operational documentation. There are no submodules or dependencies on unpublished local source folders. Hosted credentials, live database contents and report uploads remain in their existing services. Dependency folders and generated build output are reproduced from source and lockfiles.

## Run and build

Use Node.js 22 and npm. Install dependencies separately inside the component you are running with `npm ci`. Configure that component's `.env.example` values in an ignored local environment file or hosting settings; never commit credential values. Patient portal configuration is described in its README and requires the synthetic demo database.

| Component | Local development | Build / verification |
| --- | --- | --- |
| `website/` | `npm run dev` | `npm run build` |
| `landing-source/` | `npm run dev` | `npm run build` |
| `start/` | `npm run dev` | `npm run build`, `npm test`, `npm run test:compatibility`, `npm run verify` |
| `doctor-portal/` | `npm run dev` | `npm run build`, `npm test`, `npm run lint` |
| `api/` | `npm run dev` | `npm run check`, `npm test`; hosted start: `npm start` |
| `patient-portal/` | `npm run dev` | `npm run build`; hosted start: `npm start` |

For the questionnaire runtime, use `start/scripts/package-hackathon-azure.mjs` and the deployment guide in `start/docs/`. The API release uses `api/scripts/package-namat-api-azure.mjs`. The doctor release uses `doctor-portal/scripts/package-azure.py`. Shared Azure PostgreSQL, private report storage, OCR, Microsoft authentication, OpenAI and Brevo configuration are documented with the components. Database migrations and the curated datasets are included; production data is not a source-code dependency. Nested `.github/workflows/` files retain the original component release definitions as reference; they do not automatically run from this monorepo.

## Prove the demo matches this repository

`submission-provenance.json` records each original repository's full commit SHA and the SHA-256 of every copied file. `deployed-portal-source.json` records the packaged doctor release inputs. All 97 source inputs in that release were checked against `doctor-portal/` with identical hashes. `deployment-evidence.json` records the hosting verification outcome.

Run `python3 scripts/verify-submission.py` from this repository root to verify all source fingerprints. The final hackathon commit SHA is the head of `main` on this GitHub repository. Preserve that revision for judging and do not change code after 15:30 Dubai, the stricter cutoff stated in the organizer's 14:17 email.
