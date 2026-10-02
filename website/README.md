# Namat Health website

Public pre-launch website for Namat Health at `https://namat.health`, built with Astro and TypeScript.

The launch site is intentionally focused on one job: explain Namat's preventive-health model clearly enough for a visitor to decide whether to join the waitlist. It does not publish unapproved pricing, capability counts, outcome claims, launch dates or partner relationships.

## Public surface

- `/` — proposition, care cycle, intended experience, audience, founders, current-status FAQ and waitlist
- `/how-it-works/` — expanded five-stage planned journey and the decisions still being finalised
- `/privacy/` — waitlist privacy note
- `/confirmed/` — double-opt-in confirmation destination
- `/api/waitlist` — Vercel function backed by Brevo double opt-in

The original five design directions remain in Git history and on the protected `design/five-directions` branch. They are not included in the public build.

## Local development

Use Node 22. Dependencies are pinned in the lockfile.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
npm run check
npm run build
npm run verify
npm test
```

## Content and claims

Marketing copy is centralised in `src/data/content.ts`. The controlling claim audit is `docs/claim-ledger.md`, backed by the supplied Namat company deck and dated founder approvals. Capability copy must distinguish biomarker indicators and risk signals from a diagnosis.

Do not publish prices, tiers, capability counts, testimonials, outcomes, a broader clinical team, provider networks, regulatory approval or launch dates until each is approved and recorded in the claim ledger.

## Waitlist

The custom form posts JSON to `/api/waitlist`. It validates origin, payload size, email, explicit consent, route variant and a honeypot. Brevo sends the double-opt-in email and is the authoritative subscriber list. Provider or configuration failures are shown as failures; the UI never treats an unconfirmed address as subscribed.

Required Vercel environment values:

- `BREVO_API_KEY`
- `BREVO_WAITLIST_LIST_ID`
- `BREVO_DOI_TEMPLATE_ID`
- `WAITLIST_CONFIRMATION_URL`
- `WAITLIST_ALLOWED_ORIGINS`

Production confirmation returns to `https://namat.health/confirmed/`. Keep all credentials server-side and out of Git.

## Release

Production deploys from `main` through the linked Vercel project. Before release, run the type check, unit tests, static build and built-output verification. After deployment, verify the apex and `www` redirect, indexing headers, core routes and one authorised end-to-end double-opt-in signup.
