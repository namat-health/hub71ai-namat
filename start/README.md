# start.namat.health

Dedicated private source repository for the Namat welcome form at [start.namat.health/welcome](https://start.namat.health/welcome). It contains the questionnaire, confirmation emails, report uploads, background processing and reviewer interface used by the fictional-data demo.

## Build and verify

Use Node 22.19 or later in the Node 22 line:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build
npm run verify
npm test
```

The build creates `dist-hackathon/`, the standalone form package. Database integration tests need an explicit disposable loopback database; see the [deployment guide](docs/start-form-deployment.md#build-and-test-from-a-fresh-checkout). For the full form and reviewer locally, follow the [local preview instructions](services/report-processing/README.md#local-preview).

## Source layout

- `src/pages/welcome.astro`: welcome page.
- `src/hackathon/`: questionnaire, intake API, confirmation emails and submission migration.
- `services/report-processing/`: private files, processing jobs, extraction, review and report migration.
- `public/assets/`: form images and fonts.
- `scripts/`: package assembly and verification.

## Release

The [1 October 2026 release record](docs/releases/start-2026-10-01.json) records the live archive and matching checksums for 22 runtime source files and 231 image/font source assets. Building this dedicated repository changes browser chunk composition and names, so a rebuilt ZIP is a new artifact with its own checksum.

Use `npm run package:azure` on Linux x64 glibc to create the deployment ZIP. The [deployment guide](docs/start-form-deployment.md) covers macOS packaging, Azure settings, migrations and rollback. CI builds and tests without deploying. Credentials, uploaded reports and private release packages stay outside Git.
