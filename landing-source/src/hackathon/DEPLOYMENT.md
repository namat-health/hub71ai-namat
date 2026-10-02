# Standalone hackathon deployment package

The package serves the event questionnaire at `/welcome` and its intake endpoint at `/api/hackathon`. The root URL redirects to `/welcome`. The separate marketing welcome page remains part of the main website.

## Prepare locally

Run from the repository root after the current questionnaire changes have been compiled:

```sh
npm run build
node scripts/build-hackathon-site.mjs
node scripts/verify-hackathon-site.mjs
node --test tests/hackathon-package.test.mjs
```

The builder reads `dist/start/welcome/index.html` and the current API modules. It does not run a build, install dependencies, load an environment file or deploy. Re-run the website build after browser-facing changes, then re-run the package builder after any change to the page, its assets or the API/email modules.

`dist-hackathon/` is the standalone Vercel project root. Select that directory when preparing the separate project. Do not use the repository root for this isolated deployment. No project ID, token or credentials are included in the package.

## Included files

- `public/welcome/index.html`, copied from `dist/start/welcome/index.html`.
- Only the page's referenced browser JavaScript, CSS, fonts, favicon and photos. The asset scan follows JS imports and the questionnaire's dynamically chosen coast, member and hero photos.
- `api/hackathon.mjs` and its local import closure. This currently includes the hackathon HTTP/API/storage/upload/email modules, the questionnaire model, two shared overview model modules, and the email escaping/layout helper.
- A minimal `package.json` for Node 22, with only `pg` at exactly `8.23.0`. The version 3 lockfile preserves the existing integrity hashes and transitive PostgreSQL dependencies. Vercel installs these with `npm ci --ignore-scripts --no-audit --no-fund`.
- `vercel.json` with static framework selection (`null`), `public` output, no build step, a 60-second function maximum, the root redirect and security/noindex headers.
- `package-manifest.json`, listing copied files, byte lengths and SHA-256 hashes for local verification.

The folder excludes environment files, Git metadata, node_modules, source maps, development middleware, database migrations, research, other site pages and permanent funnel endpoints. Importing a local module outside the allowlist, a missing asset or a symlinked source fails packaging. Missing dependencies leave the last successfully generated package intact.

## Environment and infrastructure

Configure runtime values through the deployment platform's environment controls. The package contains none of their values:

| Variable | Purpose |
|---|---|
| `HACKATHON_ENABLED` | Enables the temporary endpoint when set to `true`. |
| `HACKATHON_DATABASE_URL` | Dedicated runtime database connection. |
| `HACKATHON_DATABASE_CA` | Optional trusted certificate when required by the database connection. |
| `HACKATHON_ALLOWED_ORIGINS` | Comma-separated exact HTTPS origins allowed to submit. Include the actual selected deployment/custom-domain origin. |
| `HACKATHON_EMAIL_MODE` | `local` for simulated delivery; `owner-test` for the designated owner address. Participant delivery is separately gated in the mailer. |
| `HACKATHON_PARTICIPANT_EMAIL_APPROVED` | Additional explicit gate for participant mode; configure only within the approved delivery scope. |
| `BREVO_API_KEY` | Required for an enabled external email mode; kept in platform secrets. |

The database migration, dedicated database role/network access, provider credentials, domain assignment and participant email authorization are separate from packaging. An unconfigured endpoint remains unavailable. See [Azure preparation](AZURE-PREPARATION.md) and [the API contract](server/README.md) for those dependencies.

## Verification limits

The local verifier checks every manifest hash, rejects extra files, re-walks the complete local module/static asset closure, and validates the minimal dependency lock and deployment configuration. The focused tests cover missing assets, symlinks, forbidden imports, unexpected files and rebuilt API content. They use local fixtures and send no emails.

These checks do not establish that Vercel has deployed the function, that Azure is reachable, or that the email provider accepted a message. After an authorized deployment, verify `/` and `/welcome`, asset loading, the intake readiness response and a fictional end-to-end submission using the approved recipient scope. Confirm delivery separately from successful database storage. The root redirect and global headers are platform configuration and need hosted verification.
