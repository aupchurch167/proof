# B06 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch (`audit/batches/B06.md`, `audit/findings/A10.md`, `audit/findings/A8.md`, `audit/system-map.md`).

Verification: `audit/verification/B06.md` (Prompt V against `151b063`). App code was not changed by the verifier.

| ID | Status |
|---|---|
| A10-01 | **Verified** — `/terms` and `/privacy` exist as client routes and server HTML; both render **DRAFT / not counsel-approved** once plus version `draft-2026-09-21`. Password signup and first-time Google require `acceptTerms` (`true` / `'true'` only). Official + probe: omit / `false` / `1` / `yes` / `TRUE` / `on` → **400** and no user. Accept → `termsAcceptedAt` / `termsVersion` / `privacyAcceptedAt` / `privacyVersion` set. Residual: existing users and **invitees** are not forced (login / existing Google / accept-invite leave nulls). `/login` Google has no checkbox and fails closed. Counsel still replaces the bodies. |
| A10-02 (eng half) | **Verified** — `POST /api/apply/:slug` returns **400** `W9_NOT_ACCEPTED` for a `w9` file, field, empty field, or JSON `w9`; vendor is not created; `uploadFile` not called. Apply UI has no W-9 input (source + `dist` grep). Existing `w9Path` is kept. `GET /api/vendors/:id` writes `w9:download` only when a signed URL is created. Authenticated `POST /vendors/:id/documents` still **200**s a W-9. Residual: same Spaces prefix / no KMS; alternate multipart names (`W9`, `w_9`, …) are multer **500** but do not store a path. |
| A8-02 / banner honesty | **Verified** — Settings billing labeled **Invoiced · not self-serve**; dead “Upgrade to Unlimited” button gone (absent from `client/src` and `client/dist`). Requirements “New template · Coming soon”; `warnInPeriod` / `retainForPeriod` labeled stored-not-enforced. Email verification banner no longer says “unlock all features.” Residual: self-serve billing and per-trade templates still unbuilt. Authenticated Settings/Requirements were not re-clicked in a browser (source + bundle). |
| A10-04 | **Verified** — Root `LICENSE` + `NOTICE` are proprietary (all rights reserved). `docs/licenses.md` exists and lists known runtimes. Residual: root `npm run licenses` errors `No packages found` on this workspace hoist (`--excludePrivatePackages` + no root production deps). Also-check is satisfied by `docs/licenses.md`. |
| A10-05 | **Verified** — Privacy draft names Google Identity Services, localStorage tokens, Resend, Anthropic, DigitalOcean Spaces, hosted PostgreSQL, optional Helm Core, Railway / Nginx / Let’s Encrypt, and Airtable-as-import-only. Explicitly not a cookie banner. Residual: counsel cookie-banner call; confirm live host list; optional Sentry (B05) is not named. |

## Deploy notes

- Replace DRAFT legal copy with counsel-approved Terms and Privacy; bump `TERMS_VERSION` / `PRIVACY_VERSION` in `server/src/legal/documents.js` and `client/src/legal/documents.js`.
- Product decision still needed: when (and whether) public apply may collect W-9s, plus retention/DPA.
- Confirm and publish the live subprocessor list (Neon vs other Postgres host, Helm Core on/off, Railway vs droplet).
- `npx prisma migrate deploy` applies additive User legal-acceptance columns (nullable; existing rows stay null).

## Residuals

- Counsel final drafts, DPA/SCCs, cookie-banner decision (A10-05 counsel call).
- Full offboarding / DSAR export (A10-03, B07+).
- HIPAA program (N/A per triage; draft only says “not intended for PHI”).
- Authenticated W-9 upload still uses the same Spaces prefix / no separate KMS.
- Existing users **and invitees** have null acceptance columns (not backfilled; not forced).
- Self-serve billing and per-trade templates remain unbuilt.
- `npm run licenses` does not inventory hoisted workspace dependencies.
- Alternate apply file field names 500 instead of typed `W9_NOT_ACCEPTED` (not stored).

## Local verification (fix author)

- Disposable DB `postgresql://proof:proof@localhost:5432/proof_test` + `PROOF_TEST_DB=1` + `prisma migrate deploy` (19 migrations including `20260921000000_add_legal_acceptance`).
- **Server `npm test`:** 27 suites, **301 passed** (B05 baseline 26 / 291 + B06 legal/product + Google acceptTerms).
- **Client `npm run build`:** vite production build succeeded with `VITE_SENTRY_DSN` unset.
- Official cases: signup without / with `acceptTerms: false` → 400; accept → versions stored; apply `w9` file/field → 400 `W9_NOT_ACCEPTED`; apply without w9 → 201 and existing `w9Path` kept; GET vendor with W-9 writes `w9:download` audit; `/terms` and `/privacy` 200 with DRAFT + subprocessors.
- Browser (Vite): signup checkbox required; `/terms` + `/privacy` DRAFT once; apply shows W-9 note and no file input; Settings billing invoiced / not self-serve; Requirements “New template · Coming soon” and coverage toggles labeled not-enforced.

## Prompt V re-run (this verification)

Same official counts on `151b063`: **27 / 301**. Client build ok (421 modules). Adjacent probes: acceptTerms truthiness, existing-user / invite nulls, apply JSON + empty + `w9Path` injection + alternate field names, authenticated documents 200, GET without W-9 has no audit, licenses script residual, legal lockstep. Browser (Vite, public routes only): `/signup` checkbox required; `/terms` `/privacy` DRAFT once + version; `/login` has links and no checkbox. GitHub Actions green on this SHA.

## GitHub Actions

**Green** on `151b063` — [Test / Server suite + client build](https://github.com/aupchurch167/proof/actions/runs/35551885805) (PR #21). Also green on `6ec4221` and `220a9c5`.

Out of scope: counsel-final legal; W-9 KMS / public-apply product decision; invite acceptance; licenses-script hoist; B07 DSAR.

**Prompt V recommendation: merge PR #21.**
