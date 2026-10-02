# Namat hackathon — welcome journey

Code for the Namat welcome journey used at the Hub71+ AI Hackathon on 2 October 2026. It is for fictional health answers and sample reports only.

- **Landing page** at https://namat.health/welcome/: `src/hackathon/welcome/WelcomeLanding.astro`, with its copy in `content.ts`.
- **Questionnaire** at https://start.namat.health/welcome: `src/hackathon/welcome/Questionnaire.astro` and `questionnaire.ts`.
- **Intake server** (`POST /api/hackathon`) with its PostgreSQL schema: `src/hackathon/server/` and `src/hackathon/db/`.
- **Report processing** (upload, OCR, extraction, doctor review): `services/report-processing/`.

The rest (`src/components`, `src/layouts`, `src/lib`, `src/styles`, `public/assets`) is copied from the main Namat website so the pages build here unchanged.

## Where this came from

This code was built on 30 September and 1 October 2026 in the `namat-website` working copy and was never pushed there. This repository is a copy of it, taken on 2 October 2026. The only change made on 2 October is the landing-page headline, "Welcome to Abu Dhabi. Let’s start your health journey together."

What's live today is not deployed from this repository:

- **namat.health/welcome/:** served by the `namat-website` Vercel project from a prebuilt copy at `public/welcome/`.
- **start.namat.health/welcome:** the questionnaire and intake API run on Azure App Service `namat-welcome-test-uaen-001`, deployed as a ZIP package.

Deployment details are in `src/hackathon/README.md` and `src/hackathon/DEPLOYMENT.md`.

## Commands

Node 22.

```bash
npm ci
npm run dev            # local site, with /api/hackathon served from the dev server
npm test               # database tests are skipped unless a local PostgreSQL is configured
npm run build          # Astro build into dist/
npm run site           # assemble the event site from dist/ into dist-hackathon/
npm run verify:site    # check that package contains only /welcome, its assets and the API
npm run package:azure  # build the Azure ZIP
```

Settings come from environment variables (`HACKATHON_*`, `NAMAT_REPORT*`, `BREVO_API_KEY`). Keep them in a private `.env.*` file, which Git ignores.
