# Azure setup and remaining publication steps — hackathon intake

30 September 2026. **The two event tables and restricted Azure runtime role are now applied and verified.** The [sanitized setup report](../../output/hackathon-azure-setup-2026-09-30.json) records 41 passing checks, the migration checksum, unchanged journey counts and confirmed firewall cleanup. No event records, emails or deployment were produced by the setup. The local browser database remains separate.

## Verified result

- Created exactly `public.hackathon_welcome_submissions` and `public.hackathon_email_outbox` in existing `namat_journey`, in one transaction with the restricted role and grants.
- Created `namat_hackathon_runtime` with the exact permissions below. Its verified TLS login passed SELECT/INSERT and allowed outbox-update probes; saved-answer changes, DELETE, journey reads and public-table creation were denied.
- All nine existing journey-table counts are unchanged. The new event tables were empty at setup completion.
- Stored `HACKATHON_DATABASE_URL` only in `/private/tmp/namat-hackathon-20260930/azure-runtime.env`, mode 0600 inside a mode-0700 directory. The local environment file and existing credentials were not replaced.
- Removed only temporary operator rule `CodexHackathonSetup_20260930_ed3b4e7b`, preserving the original three saved rules. An earlier attempt stopped during the firewall operation before database work and also verified cleanup; its [attempt record](../../output/hackathon-azure-setup-2026-09-30-attempt-1.json) is retained.

The application deployment's network access is a separate action owned by the main task; this setup did not add a broad rule.

## Confirmed configuration and scope

The existing private journey configuration points to:

- Server: `namat-pg-test-uaen-001.postgres.database.azure.com`.
- Database: `namat_journey`, schema `public`.
- Existing credentials are present in private configuration; their contents were not printed or copied into this document.
- No custom CA is configured. The application uses verified remote TLS with the runtime's certificate trust store; URL SSL flags cannot disable verification.
- The private hackathon configuration currently points to loopback database `namat_hackathon`, with origin `http://127.0.0.1:4332`. It is not an Azure connection.

The existing journey migrations 001–006 and their tables are unrelated to this event migration. The journey runtime role does not have hackathon permissions. Its credentials and privileges should remain unchanged.

## Migration procedure used

1. Establish the specifically approved operator access to this server. If a temporary client-IP firewall rule is needed, record its exact name and remove only that rule after verification. Do not enable broad Azure-services access or replace existing rules.
2. Connect using the existing private administrative configuration. Verify `current_database()='namat_journey'` and active TLS. Record only aggregate baseline counts for existing journey tables.
3. Check `to_regclass('public.hackathon_welcome_submissions')` and `to_regclass('public.hackathon_email_outbox')`. For the initial migration both should be absent. If only one exists, stop and inspect the partial state. If both exist, compare their schema/constraints with the approved migration instead of executing CREATE TABLE again.
4. Apply [001_welcome_submissions.sql](db/001_welcome_submissions.sql) in one transaction with an operator migration lock. It creates exactly the two event tables and their indexes. It creates no login and alters no journey table. The existing `journey:db migrate` runner does not discover this separate directory; do not rename the event file into the permanent journey migration sequence.
5. Verify both tables, all constraints, the cascading outbox foreign key and 30-day timestamp defaults. Confirm that the original journey counts are preserved. Keep a sanitized migration record, including the file checksum. The SQL file itself is not an idempotent migration runner.

The operator account needs CONNECT, schema USAGE/CREATE and permission to own the new tables and grant their privileges. A separate role-administration action is needed to create the runtime login below.

## Verified dedicated runtime role

Name: `namat_hackathon_runtime`. The authorized setup created this persistent login with a new high-entropy password kept in private operator storage. Its connection limit is ten; each application process opens at most two pooled connections. Revoke the role when the event is retired.

Role attributes: LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION and NOBYPASSRLS. Grant no role membership, object ownership or future default privileges.

| Resource | Exact privileges needed |
|---|---|
| Database `namat_journey` | CONNECT |
| Schema `public` | USAGE |
| `public.hackathon_welcome_submissions` | SELECT, INSERT |
| `public.hackathon_email_outbox` | SELECT, INSERT; UPDATE of `status`, `claim_token`, `claimed_at`, `attempts`, `provider_message_id`, `last_error_code`, `sent_at`, `available_at` only |

Set this role's database search path to `pg_catalog, public`. No DELETE, TRUNCATE, sequence privileges, application SQL functions, schema CREATE, migration-ledger access or journey-table access is needed. Retention is an operator task; do not expand the API role for it.

The setup verified effective permissions including PostgreSQL PUBLIC, no memberships or owned relations, and a TLS login. It checked the permissions below with metadata and zero-row SQL probes. A full hosted submission remains a separate check:

- SELECT/INSERT on both event tables and only the listed UPDATE columns on the outbox.
- No UPDATE on saved answers, contact details or report bytes; no DELETE/TRUNCATE on either event table.
- No public-schema CREATE, database CREATE, journey migration-ledger access or access to existing journey records.

The local native suite separately verified bounded submissions, idempotent retries, binary persistence, atomic queue rollback, concurrent claims and uncertain outcomes. The Azure setup intentionally created no event rows and invoked no sender. Repeat the relevant end-to-end checks through the eventual hosted application using fictional data.

Any unexpected effective privilege or missing runtime privilege needs review. Do not silently broaden grants. Never reuse the existing journey runtime login for the event.

## Vercel connection and publication

**Published:** `start.namat.health/welcome` now connects to this database. After explicit user approval, rule `hackathon-vercel-20260930` was added for all IPv4 addresses, with no automatic expiry; it must be closed after the hackathon. Passwords, verified TLS and the restricted runtime grants remain in force. Hosted checks passed and the public domain is live. The procedures below remain reference guidance; the [release record](RELEASE-2026-09-30.md) is the final status.

The production-shaped event origin is `https://start.namat.health`. Configure only the reviewed deployment's server environment with `HACKATHON_ENABLED=true`, that exact allowed origin, and the new role's `HACKATHON_DATABASE_URL`. Keep the database URL, mail API key and any CA out of public build variables and artifacts.

Resolve the actual Vercel deployment's database network access before enabling collection. An operator's client-IP rule does not authorize Vercel, and this plan does not assume that the deployment has fixed egress IPs. Apply only the event network policy authorized in the main task; the database setup above did not apply it.

A read-only Azure management inventory listed `namat_journey`, default database `postgres`, and Azure's `azure_sys`/`azure_maintenance`; no additional named user database appeared. The contents of `postgres` and a complete inventory of login roles were not inspected in this setup. A server firewall rule covers authentication to the whole PostgreSQL server, including the administrative and existing journey roles. The event role's isolation does not change those other accounts' permissions.

After configuration, verify the hosted same-origin endpoint and a complete fictional browser submission both with and without reports. Confirm the stored byte digests, receipt idempotency and delivery-state response. Keep external email in owner-test mode until recipient policy is separately approved. The database setup does not establish deployment or hosted-check completion.

When the event ends, revoke the dedicated login, remove its secret from the deployment, stop event writes, and apply the approved expiry/cleanup process to these two tables. Preserve existing journey data, roles and network rules.
