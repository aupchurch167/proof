# Notes from B01–B06 (residuals)

**Release gate (2026-09-21): [NO-GO](../release-gate.md)** — do not charge customers until the hard-requirement checklist there is closed. Residuals below are known risk, not a GO.

# Notes from B01 (not fixed in this batch)

- Cron, v1 COI-request, rejection, chase, and reminder `NotificationLog` rows still do not persist Resend `email_id` in `meta`. Inbound bounce correlation therefore depends on `email_id` only when `/api/vendors/:id/request-coi` stored it, or on a single-org SENT match. Residual of A2-08.
- Inbound replies from a vendor `additionalEmails` address are correlated only if a SENT `UPLOAD_REQUEST` exists for that address. A reply from a CC that was never the `recipientEmail` is skipped.
- `/api/webhooks` remains mounted before the rate limiter (intentional for Resend retries; still an unauthenticated CPU/SSRF-adjacent surface if the secret leaks).
- Outbound webhook delivery re-checks scheme/host/IP literals but does not re-resolve DNS at send time (registration-time resolve only).
- `core.updateVendor` / `listVendors` still fall back to `CORE_ORG_SLUG` when no vendor org is supplied (delete / list helpers). Create/update paths used by the app pass the vendor.
- Non-production Core calls still send `x-helm-test-*` bypass headers (Core has no real auth yet). Production refuses those headers and requires `CORE_API_TOKEN`.

# Notes from B02 (extras / residuals)

- Signup still returns tokens for **new** accounts (so `/auth/me` and resend-verify work). Existing emails get the same **201** without tokens. Response body shape can still enumerate; status no longer does (A1-06 residual).
- Invite of an already-registered email stays **409** (authenticated admin inside an org — allowed by A1-06).
- `inviteToken` plaintext column is kept (expand). New invites write hash + expiry only. Contract (drop column) later.
- Existing refresh JWTs issued before this deploy are not in `Session` and will 401 on `/auth/refresh`. Users re-login. No HttpOnly cookie migration (A1-07, out of scope).
- Refresh JWTs now include a random `jti` so two logins in the same second do not collide on `Session.tokenHash`.
- Public apply is slug-only. New signup/Google orgs now get an auto-generated slug (extra). Existing orgs without a slug cannot use `/apply/:id` anymore; Settings hides the apply URL until a slug exists. There is still no ADMIN UI to set `Organization.slug`.
- ADMIN `GET /organization/usage` mints a 15-minute portal JWT (not the stored `uploadToken`). MEMBER/VIEWER do not receive the key.
- Portal no longer matches the stored token string; a valid `purpose=upload` JWT for the vendor id works. UUID tokens 401 until cron/request-coi rotates them to JWTs.
- Google-only accounts (no password) cannot change email until they set a password.
- `SEED_PASSWORD` is optional and not boot-validated. Seed still defaults to `password123` outside production.

# Notes from B03 (not fixed in this batch)

- Individual `DELETE /api/cois/:id` still hard-deletes the row and calls `deleteFile`. Vendor delete is the A3-02 path; per-certificate recycle is a follow-up.
- A3-03 remainder: Settings / User / Vendor / Coi / NotificationLog / ApiClient / CoiRequest / WebhookEndpoint still `onDelete: Cascade` from Organization. Only AuditLog is Restrict. Need an offboarding job + written cascade plan before flipping the rest.
- Vendor live-email unique is exact `(orgId, email)`, not `lower(email)`. `Foo@x.com` and `foo@x.com` can both exist.
- Import still creates vendors one row at a time (token is now minted; the CSV is not one transaction).
- Cron is still in-process. Advisory lock prevents double-send across processes; a missed 08:00 tick still waits until the next scheduled run (expiration windows catch up; token refresh does not).
- SIGTERM stops cron timers but does not wait for an in-flight sweep before the 10s HTTP/Prisma shutdown fuse.
- Restore rehearsal / Neon PITR (A3-01) remains owner-owned.

# Notes from B05 (extras / residuals)

- Branch protection / required CI check on `main` is an owner action. The workflow file is in-repo; GitHub must be told to require the `Server suite + client build` check before merge.
- Sentry projects and DSNs are owner-created after merge. `SENTRY_DSN` (API) and `VITE_SENTRY_DSN` (SPA build) are optional; the app boots and CI builds without them. Until they are set, 500s still only go to `console.error` / morgan.
- Sentry `beforeSend` redacts emails and auth/cookie headers. Request bodies that do not look like email/token keys are not fully stripped.
- Friday-deploy matrix beyond the named cases (WH-1, V-01, C-02, O-03, L-02) plus the existing Friday file list is still out of scope. Full `/audit/tenant-isolation-tests.md` remains open.
- `cleanupTestData` still truncates every table once the guard passes. A developer who sets `PROOF_TEST_DB=1` against a shared DB can still wipe it.

# Notes from B04 (extras / residuals)

- A4-09 Railway CORS origin `https://proof.up.railway.app` is **owner-confirmed keep**. CSP `'unsafe-inline'` styles and unauthenticated `/api/health` `{db}` detail were part of the same Low finding and were not changed.
- Extract daily cap is counted in `AuditLog` (`action=extract`, `entity=ai`) so no migration was added. Concurrent extracts can theoretically overshoot by a small amount (count-then-insert). Failed Anthropic calls after `getClient()` consume a slot.
- Webhook inbound still accepts a PDF-mimetype attachment without `%PDF-` (stores it, skips extract) so Resend is not failed. Admin/portal/apply COI uploads reject those with 400.
- Vendor PUT zod accepts `notes` (the SPA sends it) but the handler still does not persist `notes` (pre-existing).
- `EXTRACT_DAILY_CAP` / `EXTRACT_MAX_BYTES` are optional with defaults (10 / 4MB) and are not boot-validated.
- A4-06 residual: `npm audit --omit=dev` still reports 3 highs for `deepmerge-ts` via Prisma CLI (`prisma` → `@prisma/config`). Not on the request path. `qs` (Express) and `uuid` via `gaxios` remain moderate. Client `react-router` 6.x moderates need a v7 major (`npm audit fix --force`) — not taken.
