# Staged hosted verification — 30 September 2026

**Passed: 38 of 38 checks.** The staged Vercel API saved two fictional cases in Azure through `namat_hackathon_runtime`. The same deployment was subsequently promoted to `start.namat.health` and checked in Chrome without Vercel sign-in; see the [release record](RELEASE-2026-09-30.md).

- Deployment: `dpl_44g8JLq6VF8KfDtUHNKoprA7NCcn`, accessed through the authenticated Vercel CLI.
- API: `/api/hackathon`; requests used the allowed origin `https://start.namat.health`.
- Database: existing `namat_journey` on `namat-pg-test-uaen-001`, with verified TLS.
- Evidence: [sanitized rehearsal report](../../output/hackathon-hosted-rehearsal-2026-09-30.json).

## Cases and results

| Case | HTTP result | Stored reports | Email result |
|---|---|---|---|
| Fictional questionnaire, no recent bloodwork | 201 with receipt | None | Blocked by owner-only recipient policy |
| Fictional questionnaire, recent bloodwork | 201 with receipt | One valid PNG, 69 bytes | Blocked by owner-only recipient policy |

Both recipients use `example.invalid`. No owner address was used. The queue has two entries with `sender_blocked`, no provider message IDs and no sent timestamps. **No provider accepted a message.**

An identical repeat of the first request returned the same receipt. Changing its email while retaining the request ID returned 409. Those additional HTTP requests created no additional submissions or queue entries.

Scoped database reads verified both receipt IDs, the normalized contact fields, questionnaire version, fictional-data flags, exact answers/notes, matching report metadata/bytes/SHA-256, and 30-day expiry. Queue entries matched their submission references and contained no health payload. The runtime still had no read/write access to any of the nine journey tables; an actual journey read returned a permission error.

| Event records | Before | After |
|---|---:|---:|
| Submissions | 0 | 2 |
| Confirmation outbox | 0 | 2 |

Only these two cases were submitted. Their fictional records remain under normal retention. This run did not change firewall rules, secrets, deployment settings or existing journey records. It did not exercise external email delivery, AI processing, doctor review or the later recommendation email.
