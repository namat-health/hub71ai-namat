# Namat API service

See the [repository README](../../README.md) for setup, source ownership and releases.

The service runs two explicitly separate interfaces:

- [Isolated intake](contracts/README.md): `/v1/submissions`, with a pinned questionnaire revision, separate staging schema and pending confirmations. This remains useful for contract testing.
- [Connected fictional demo](../../docs/demo-integration.md): `/v1/demo/*`, with scoped server credentials for the questionnaire and signed-in doctor portal. It delegates to the existing report engine so submissions, reports, jobs and emails retain one storage owner during migration.

The original private bearer credential protects staging readiness and contract discovery. Connected demo callers use distinct intake and portal service keys; neither key is a patient or doctor identity. The portal enforces Microsoft sign-in before its server calls the API. No shared key belongs in browser JavaScript.

The API exposes generic process health at `/healthz`. Database initialization remains a separate local-only command, and no migration runs at startup. Cloud credentials are held in Azure configuration. Framework changes, physical worker extraction and clinical-plan workflows can evolve behind the published interface.
