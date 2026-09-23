# B04 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch.

Verification: `audit/verification/B04.md` (Prompt V against `f5d018c`). App code was not changed by the verifier.

| ID | Status |
|---|---|
| A4-03 | **Verified** — `escapeHtml` on org/vendor/reason/URL interpolations in every HTML builder in `services/email.js`. Subjects stay raw plain text. Residual: no `text/plain` part (`sendEmail` is HTML-only). |
| A4-04 | **Verified** — 4MB default `EXTRACT_MAX_BYTES` (413 `EXTRACT_BYTE_LIMIT`) and per-org daily `EXTRACT_DAILY_CAP` default 10 (429 `EXTRACT_DAILY_CAP`). Counted via `AuditLog` `extract`/`ai` (no migration). All HTTP callers pass `orgId`. Cross-org isolation holds. Residual: AuditLog count-then-insert can theoretically overshoot; failed Anthropic after `getClient()` consumes a slot; scripts without `orgId` skip the daily cap. Webhook skips Anthropic on cap instead of failing Resend. |
| A4-05 | **Verified** — zod on settings PUT, vendor PUT, Google, forgot-password, apply. Privileged keys `plan` / `role` / `orgId` rejected (400). Settings chase-day normalization unchanged. Mass-assignment of extra vendor columns (`uploadToken` / `deletedAt` / `coreId`) is ignored. Residual: request-coi / invite / integrations / portal PUT / import `headerMap` were not in the batch work item. |
| A4-06 | **Verified** — unused `nodemailer` removed (not in the tree). Remaining `npm audit --omit=dev` highs: **3**, all `deepmerge-ts` via Prisma CLI (`prisma` → `@prisma/config`). Not on the request path. Moderates: `qs` (Express), `uuid` via `gaxios`. |
| A4-07 | **Verified** — `%PDF-` magic on admin / portal / apply COI uploads (400). Webhook PDFs without magic skip extract but still store (200, probed). Residual: reanalyze does not re-check magic. |
| A4-08 | **Verified** — `POST /api/reports/export-pdfs` rejects `coiIds.length > 50` with 400. 50 unknown IDs fall through to 404 (length accepted). |
| A4-09 | **Deferred — owner-confirmed keep** — Railway CORS origin `https://proof.up.railway.app` left in place (preflight allowed). `https://evil.com` denied. CSP `unsafe-inline` and health `db` detail unchanged (out of this skip). Not “Not fixed.” |
| A4-10 | **Verified** — notifications use `parseLimit` (max 200) and `parseOffset` (NaN / negative → 0). Official `?limit=999999` returns 200 items. Residual: offset has no upper bound. |
| A5-03 | **Verified** — root `.gitignore` adds `.env.*`, `!.env.example`, `!**/.env.example`, `*.pem`. `git check-ignore` matches `server/.env.production`; `.env.example` files stay trackable. |

No migrations. New optional env vars: `EXTRACT_DAILY_CAP`, `EXTRACT_MAX_BYTES` (documented in `server/.env.example`; defaults apply if unset; not required at boot).

**Prompt V recommendation: merge PR #17.**

Official `npm test` (this branch, re-run by verifier): **24 suites, 283 tests, passed.**

Backlog (`audit/backlog.md`) is only on PR #9; not copied onto this branch. Update those rows to the statuses above when #9 lands.
