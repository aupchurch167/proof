# B06 status

**Fixed — pending verification.**

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch (`audit/batches/B06.md`, `audit/findings/A10.md`, `audit/findings/A8.md`, `audit/system-map.md`).

| ID | Status |
|---|---|
| A10-01 | **Fixed — pending verification** — `/terms` and `/privacy` exist as client routes and server HTML. Signup (password + first-time Google) requires `acceptTerms`. Acceptance stored as `termsAcceptedAt` / `termsVersion` / `privacyAcceptedAt` / `privacyVersion` (`draft-2026-09-21`). Body copy is clearly **DRAFT / not counsel-approved**. |
| A10-02 (eng half) | **Fixed — pending verification** — `POST /api/apply/:slug` returns 400 `W9_NOT_ACCEPTED` if a `w9` file or field is present. Apply UI no longer offers the upload. Existing `w9Path` values are not deleted. `GET /api/vendors/:id` audit-logs `w9:download` when a signed W-9 URL is created. Authenticated `POST /vendors/:id/documents` still accepts W-9s. |
| A8-02 / banner honesty | **Fixed — pending verification** — Settings billing labeled invoiced / not self-serve; dead “Upgrade to Unlimited” button removed. Requirements “New template” labeled Coming soon; `warnInPeriod` / `retainForPeriod` labeled as stored-not-enforced. Email verification banner no longer claims “unlock all features.” |
| A10-04 | **Fixed — pending verification** — Root `LICENSE` + `NOTICE` are proprietary (all rights reserved; repo did not imply OSS). `docs/licenses.md` + root `npm run licenses` document `license-checker`. |
| A10-05 | **Fixed — pending verification** — Privacy draft names Google Identity Services, localStorage tokens, Resend, Anthropic, DigitalOcean Spaces, hosted PostgreSQL, optional Helm Core, Railway / TLS infra, and Airtable-as-import-only. |

## Deploy notes

- Replace DRAFT legal copy with counsel-approved Terms and Privacy; bump `TERMS_VERSION` / `PRIVACY_VERSION` in `server/src/legal/documents.js` and `client/src/legal/documents.js`.
- Product decision still needed: when (and whether) public apply may collect W-9s, plus retention/DPA.
- Confirm and publish the live subprocessor list (Neon vs other Postgres host, Helm Core on/off, Railway vs droplet).
- `npx prisma migrate deploy` applies additive User legal-acceptance columns.

## Residuals

- Counsel final drafts, DPA/SCCs, cookie-banner decision (A10-05 counsel call).
- Full offboarding / DSAR export (A10-03, B07+).
- HIPAA program (N/A per triage; draft only says “not intended for PHI”).
- Authenticated W-9 upload still uses the same Spaces prefix / no separate KMS.
- Existing users have null acceptance columns (not backfilled).
- Self-serve billing and per-trade templates remain unbuilt.

## Local verification (fix author)

- Disposable DB `postgresql://proof:proof@localhost:5432/proof_test` + `PROOF_TEST_DB=1` + `prisma migrate deploy` (19 migrations including `20260921000000_add_legal_acceptance`).
- **Server `npm test`:** 27 suites, **301 passed** (B05 baseline 26 / 291 + B06 legal/product + Google acceptTerms).
- **Client `npm run build`:** vite production build succeeded with `VITE_SENTRY_DSN` unset.
- Official cases: signup without / with `acceptTerms: false` → 400; accept → versions stored; apply `w9` file/field → 400 `W9_NOT_ACCEPTED`; apply without w9 → 201 and existing `w9Path` kept; GET vendor with W-9 writes `w9:download` audit; `/terms` and `/privacy` 200 with DRAFT + subprocessors.
- Browser (Vite): signup checkbox required; `/terms` + `/privacy` DRAFT once; apply shows W-9 note and no file input; Settings billing invoiced / not self-serve; Requirements “New template · Coming soon” and coverage toggles labeled not-enforced.

## GitHub Actions

**Green** on `6ec4221` — [Test / Server suite + client build](https://github.com/aupchurch167/proof/actions/runs/35551746058/job/106187643888) (PR #21). Still **Fixed — pending verification** (Prompt V).
