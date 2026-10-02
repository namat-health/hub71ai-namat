# Start form and report workflow

This directory contains the questionnaire and intake runtime deployed at **https://start.namat.health/welcome**. It belongs to the dedicated private repository `namat-health/start.namat.health`. The page entrypoint is [`src/pages/welcome.astro`](../pages/welcome.astro), and Azure serves the assembled form package.

- `welcome/`: questionnaire, branching model and client upload flow.
- `server/`: intake API, atomic submission/email outbox, Brevo confirmation and Azure HTTP entrypoint.
- `db/001_welcome_submissions.sql`: submissions and confirmation outbox.
- [`services/report-processing`](../../services/report-processing/README.md): private files, durable processing jobs, PDF text extraction, image/scanned-PDF OCR and source review.
- [`docs/start-form-deployment.md`](../../docs/start-form-deployment.md): setup, cloud settings, permissions, packaging, deployment and rollback.
- [`docs/releases/start-2026-10-01.json`](../../docs/releases/start-2026-10-01.json): checksums of the source and assets recovered from the deployed release.

From the repository root, run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, `npm run build`, `npm run verify`, and `npm test` with Node 22.19 or later in the Node 22 line. The full local preview requires a local PostgreSQL database; follow the report-processing README. The build requires no database connection or credentials. Use `npm run package:azure` with the Linux runtime dependencies described in the deployment guide.

The release record preserves checksums for the original live runtime and assets. Building the standalone page changes browser chunk composition and names, so future ZIPs have their own release hashes.

This is the fictional-data demo: three PDF, PNG or JPEG files, at most 10 MiB each and 50 pages per PDF. Original files stay in private Blob storage. `namat_reports.submission_id` links each file to `hackathon_welcome_submissions.id`. Extracted results are drafts; the existing shared-key reviewer can correct and approve them. This source-control snapshot does not change that behavior.
