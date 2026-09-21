# B05 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch (`audit/batches/B05.md`, `audit/findings/A6.md`, `audit/findings/A9.md`, `audit/tenant-isolation-tests.md`).

| ID | Status |
|---|---|
| A9-01 | **Fixed — pending verification** — `.github/workflows/test.yml` runs on every PR and on `main`: Node 22, root `npm ci` (workspaces), disposable Postgres 16 (`proof_test`), `prisma migrate deploy`, `cd server && npm test` (Jest fails the job on any failed expect), then `cd client && npm run build`. |
| A9-02 | **Fixed — pending verification** — Friday-deploy files are in CI via full `npm test`. `npm run test:friday` runs that list plus inbound webhooks + B02 isolation. Named cases: **WH-1** `webhooks-inbound.test.js`, **V-01** / **O-03** / **L-02** `b02-auth-portal.test.js` (already on main from B01–B02). **C-02** added in `cois.test.js` (GET `/api/cois/:id` as org A against org B → 404, no body leak). Not duplicated. |
| A9-03 | **Fixed — pending verification** — already aligned on main after B02: `portal.test.js` expects **401** for invalid / expired / non-upload JWT; `portal.js` `loadPortalVendor` returns 401 on verify failure. No test weakening. |
| A9-05 | **Fixed — pending verification** — `cleanupTestData` throws unless `PROOF_TEST_DB=1` or `DATABASE_URL` contains `_test`. `cleanup-guard.test.js`: org named `keep-me` survives when the URL is production-shaped and the flag is unset. |
| A6-01 | **Fixed — pending verification** — `@sentry/node` + `@sentry/react`. Init only when `SENTRY_DSN` / `VITE_SENTRY_DSN` is set. Release from `SENTRY_RELEASE` / `VITE_SENTRY_RELEASE` (fallback: Railway SHA / `GITHUB_SHA`). `sendDefaultPii: false` + `beforeSend` email/auth scrub. Documented in both `.env.example` files. App and client build boot with no DSN. |

No migrations. New optional env (not required at boot): `SENTRY_DSN`, `SENTRY_RELEASE`, `SENTRY_ENVIRONMENT`, `VITE_SENTRY_DSN`, `VITE_SENTRY_RELEASE`, `VITE_SENTRY_ENVIRONMENT`. Tests require `PROOF_TEST_DB=1` or a `_test` database URL.

## How a broken expect fails CI

`server` script is `jest --runInBand --forceExit --detectOpenHandles`. Jest exits non-zero on any failed assertion. The GitHub Actions step `Server tests` uses the default `set -e` behavior, so a red suite fails the workflow and blocks merge once the owner requires this check.

Out of scope: B06 legal; making the GitHub check required (owner); full tenant-isolation matrix.

**Prompt V recommendation:** do not merge until verification.
