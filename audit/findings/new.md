# Notes from B01 (not fixed in this batch)

- Cron, v1 COI-request, rejection, chase, and reminder `NotificationLog` rows still do not persist Resend `email_id` in `meta`. Inbound bounce correlation therefore depends on `email_id` only when `/api/vendors/:id/request-coi` stored it, or on a single-org SENT match. Residual of A2-08.
- Inbound replies from a vendor `additionalEmails` address are correlated only if a SENT `UPLOAD_REQUEST` exists for that address. A reply from a CC that was never the `recipientEmail` is skipped.
- `/api/webhooks` remains mounted before the rate limiter (intentional for Resend retries; still an unauthenticated CPU/SSRF-adjacent surface if the secret leaks).
- Outbound webhook delivery re-checks scheme/host/IP literals but does not re-resolve DNS at send time (registration-time resolve only).
- `core.updateVendor` / `listVendors` still fall back to `CORE_ORG_SLUG` when no vendor org is supplied (delete / list helpers). Create/update paths used by the app pass the vendor.
- Non-production Core calls still send `x-helm-test-*` bypass headers (Core has no real auth yet). Production refuses those headers and requires `CORE_API_TOKEN`.
- `server/tests/portal.test.js` already expects 401 on an invalid portal token (A1-13 / B02). Current portal lookup still 404s. Pre-existing on `main`; not changed in this batch.
