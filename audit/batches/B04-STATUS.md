# B04 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch.

Verification: pending (Prompt V).

| ID | Status |
|---|---|
| A4-03 | **Fixed — pending verification** — `escapeHtml` on org/vendor/reason interpolations in `services/email.js`. Subjects stay plain text. |
| A4-04 | **Fixed — pending verification** — 4MB default `EXTRACT_MAX_BYTES` (413 `EXTRACT_BYTE_LIMIT`) and per-org daily `EXTRACT_DAILY_CAP` default 10 (429 `EXTRACT_DAILY_CAP`). Counted via `AuditLog` `extract`/`ai` (no migration). Callers pass `orgId`. Webhook skips Anthropic on cap instead of failing Resend. |
| A4-05 | **Fixed — pending verification** — zod on settings PUT, vendor PUT, Google, forgot-password, apply. Privileged keys `plan` / `role` / `orgId` rejected. Settings chase-day normalization unchanged. |
| A4-06 | **Fixed — pending verification** — unused `nodemailer` removed (nodemailer highs gone). `npm audit fix` applied. Remaining `npm audit --omit=dev` highs: **3**, all `deepmerge-ts` via Prisma CLI (`prisma` → `@prisma/config`). Not on the request path; fixing requires a Prisma major bump (out of scope). Moderates: `qs` (Express), `uuid` via `gaxios`. |
| A4-07 | **Fixed — pending verification** — `%PDF-` magic on admin / portal / apply COI uploads (400). Webhook PDFs without magic skip extract but still store. |
| A4-08 | **Fixed — pending verification** — `POST /api/reports/export-pdfs` rejects `coiIds.length > 50` with 400. |
| A4-09 | **Deferred — owner-confirmed keep** — Railway CORS origin `https://proof.up.railway.app` left in place. CSP `unsafe-inline` and health `db` detail unchanged (out of this skip). |
| A4-10 | **Fixed — pending verification** — notifications use `parseLimit` (max 200) and `parseOffset` (NaN → 0). |
| A5-03 | **Fixed — pending verification** — root `.gitignore` adds `.env.*`, `!.env.example`, `!**/.env.example`, `*.pem`. |

No migrations. New optional env vars: `EXTRACT_DAILY_CAP`, `EXTRACT_MAX_BYTES` (documented in `server/.env.example`; defaults apply if unset; not required at boot).
