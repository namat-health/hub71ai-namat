# Namat API

Shared backend interface for the Namat fictional demo. Node 22, PostgreSQL and Azure App Service. This private repository owns the API contract, server, server-side clients, tests and release package.

## Current integration

The independently deployed API provides two explicit interfaces:

- `/v1/submissions`: the original isolated staging intake. Separate test schema; confirmations stay pending.
- `/v1/demo/*`: the shared interface for the existing questionnaire and signed-in doctor portal. During this migration it delegates to the existing report engine, which remains the single owner of the saved cases, private uploads, email outbox, processing jobs and retention. No records or email sends are mirrored.

The questionnaire and portal keep their same-origin browser routes. Their servers authenticate to this API using different credentials. The API authenticates its calls to the existing engine with a third credential. None of these credentials belongs in a browser bundle. The portal continues enforcing Microsoft sign-in before it calls the shared API. The current permitted clinicians share the fictional workspace.

This interface serves the existing demo. Extracted lab values and their review history are separate from diagnostic-plan generation, which is outside this milestone.

## Commands

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run package:azure
```

Native database tests require explicit loopback test URLs in `NAMAT_API_TEST_DATABASE_URL`, `HACKATHON_TEST_DATABASE_URL` and `REPORT_TEST_DATABASE_URL`. GitHub Actions supplies disposable PostgreSQL; tests must never use cloud credentials. Linux packaging requires Linux native dependencies, or a separately prepared matching Linux dependency directory via `NAMAT_RUNTIME_NODE_MODULES` on macOS.

For local API development, copy the environment example into ignored `.env.namat-api.local`, configure a local database and use `npm run db:init`, then `npm run dev`. Initialization only creates a dedicated local schema. Cloud migrations never run during server startup or deployment.

## Contract and deployment

- [Original staging contract](services/namat-api/contracts/README.md)
- [Demo integration contract and rollout](docs/demo-integration.md)
- [Live components, releases and recovery](docs/operations.md)
- [Release workflow](.github/workflows/api.yml): checks every pull request/push; Azure deployment requires a manual run from `main` with `deploy=true`.
- `source-import.json` records the extracted source paths and hashes. The initial runtime was checked against the earlier staging package before adding the demo bridge. Website assets, private configuration and research files are excluded.

The Azure app remains `namat-api-staging-uaen-001` on the existing B1 plan. GitHub deployment uses a scoped federated identity; database and service credentials remain in Azure configuration. The deployment identity has Website Contributor permission only over this API app. GitHub's [Azure federation guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure) explains the short-lived login mechanism.

The consumer repositories are [start.namat.health](https://github.com/namat-health/start.namat.health) and [doctor-portal](https://github.com/namat-health/doctor-portal). Keep their adapters compatible and switch them only after hosted parity checks pass. A failure never silently falls back to a second database writer.
