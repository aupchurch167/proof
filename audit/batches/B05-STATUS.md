# B05 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch (`audit/batches/B05.md`, `audit/findings/A6.md`, `audit/findings/A9.md`, `audit/tenant-isolation-tests.md`).

Verification: `audit/verification/B05.md` (Prompt V against `f16466e`). App code was not changed by the verifier.

| ID | Status |
|---|---|
| A9-01 | **Verified** — `.github/workflows/test.yml` runs on every PR and on `main`: Node 22, root `npm ci`, disposable Postgres 16 (`proof_test`), `prisma migrate deploy`, `cd server && npm test`, then `cd client && npm run build` with `VITE_SENTRY_DSN` empty. Jest non-zero on a failed expect (reproduced: `expect(1).toBe(2)` → exit 1). GitHub Actions **green** on `f16466e` — [Test / Server suite + client build](https://github.com/aupchurch167/proof/actions/runs/35548283642/job/106178130825) (26 suites / 291 tests + Vite). Residual: making the check required on `main` is owner-owned (`gh` 403 here). |
| A9-02 | **Verified** — Friday-deploy files are in CI via full `npm test`. `npm run test:friday` is listed and ran **11 / 144**. Named cases assert isolation, not smoke: **WH-1** `webhooks-inbound.test.js` (COI + audit only on the last-request org); **V-01** / **O-03** / **L-02** `b02-auth-portal.test.js` (no other-org vendors / no B portal token / apply UUID 404); **C-02** `cois.test.js` (GET other-org COI → 404, no body leak). Adjacent V-02/V-03/C-01/C-03/C-05 also 404. Residual: full `/audit/tenant-isolation-tests.md` matrix still open. |
| A9-03 | **Verified** — `portal.test.js` expects **401** for invalid / expired / non-upload JWT; `loadPortalVendor` returns 401 on verify failure. Probe: PUT/POST expired + wrong secret + `alg=none` also 401; expired PUT does not mutate. Valid JWT + missing vendor is 404 (B02 residual). No test weakening. |
| A9-05 | **Verified** — `cleanupTestData` throws unless `PROOF_TEST_DB=1` or `DATABASE_URL` contains `_test`. Official + probe: org named `keep-me` survives a production-shaped URL with the flag unset. After the guard is satisfied, cleanup still wipes (keep-me gone). Residual: still truncates every table once allowed; `PROOF_TEST_DB=1` against a shared URL is an operator foot-gun; `_test` anywhere in the URL string (user/host/password) satisfies the substring check. `true`/`yes`/hyphen `proof-test` refuse. |
| A6-01 | **Verified** — `@sentry/node` + `@sentry/react`. Init only when `SENTRY_DSN` / `VITE_SENTRY_DSN` is set. `require('./src/app')` with no DSN boots; fake DSN `initSentry` / require does not throw. `sendDefaultPii: false` + `beforeSend` email/auth scrub (probed). Client Vite build succeeds with `VITE_SENTRY_DSN` unset; no ingest DSN in `dist/` or the repo (`git grep`). Residual: live Sentry project is owner-created after merge; client scrub is thinner than Node; whitespace-only DSN is truthy; helmet `connect-src` allows `*.sentry.io` even without a DSN. |

No migrations. New optional env (not required at boot): `SENTRY_DSN`, `SENTRY_RELEASE`, `SENTRY_ENVIRONMENT`, `VITE_SENTRY_DSN`, `VITE_SENTRY_RELEASE`, `VITE_SENTRY_ENVIRONMENT`. Tests require `PROOF_TEST_DB=1` or a `_test` database URL.

## Local verification (fix author)

- Workflow YAML parses (`python3` PyYAML). Job name `Test`, service `postgres:16`, server step `npm test`.
- Disposable DB `postgresql://proof:proof@localhost:5432/proof_test` + `PROOF_TEST_DB=1` + `prisma migrate deploy`.
- **Server `npm test`:** 26 suites, **291 passed** (B04 baseline 283 + C-02 + 4 cleanup-guard + 3 Sentry).
- **`npm run test:friday`:** 11 suites, **144 passed** (Friday file list + inbound + B02 isolation).
- **Client `npm run build`:** vite production build succeeded with `VITE_SENTRY_DSN` unset.
- Broken expect demo (`expect(1).toBe(2)` in a throwaway Jest file): **exit 1**.
- `require('./src/app')` with no `SENTRY_DSN`: boots.
- `cleanupTestData` against `.../proof` without `PROOF_TEST_DB`: throws the refuse message; `keep-me` org survives in the dedicated test.

## Prompt V re-run (this verification)

Same official counts on `f16466e`: **26 / 291** and Friday **11 / 144**. Client build ok. Adjacent probes (59/59): isolation IDOR, portal 401 on GET/PUT/POST, keep-me + successful wipe, fake DSN no throw, secret scan clean. GitHub Actions green on this SHA.

## GitHub Actions

**Green** on `f16466e` — [Test / Server suite + client build](https://github.com/aupchurch167/proof/actions/runs/35548283642/job/106178130825) (PR #19). Also green on `326963b` and `569d5e9`. A9-01 is live: a failing expect on this workflow would have failed the check.

## How a broken expect fails CI

`server` script is `jest --runInBand --forceExit --detectOpenHandles`. Jest exits non-zero on any failed assertion (locally reproduced: exit 1). The GitHub Actions step `Server tests` uses the default `set -e` behavior, so a red suite fails the workflow and blocks merge once the owner requires this check.

Out of scope: B06 legal; making the GitHub check required (owner); full tenant-isolation matrix.

**Prompt V recommendation: merge PR #19.**
