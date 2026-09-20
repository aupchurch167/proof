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
- Public apply is slug-only. New signup/Google orgs now get an auto-generated slug (extra). Existing orgs without a slug cannot use `/apply/:id` anymore; Settings hides the apply URL until a slug exists. There is still no ADMIN UI to set `Organization.slug`.
- ADMIN `GET /organization/usage` mints a 15-minute portal JWT (not the stored `uploadToken`). MEMBER/VIEWER do not receive the key.
- Portal no longer matches the stored token string; a valid `purpose=upload` JWT for the vendor id works. UUID tokens 401 until cron/request-coi rotates them to JWTs.
- Google-only accounts (no password) cannot change email until they set a password.
- `SEED_PASSWORD` is optional and not boot-validated. Seed still defaults to `password123` outside production.
