# Proof release gate — charging customers

**Date:** 2026-09-21  
**Reviewed SHA:** `db5d9f2` (`origin/main` after B01–B06)  
**Reviewer stance:** engineering lead, evidence-only. Owner/ops actions that are not in this repo or in a verification write-up are **unmet**.  
**Sources:** `/audit/` on `main`; original backlog and findings on PR #9 (`cursor/audit-pre-launch-30f7`); Prompt V write-ups for B01–B06 (PRs #11, #13/#14, #16, #18, #20, #22).

---

# **NO-GO**

Engineering closed the three Criticals and almost every High that can be fixed in application code (PRs #10–#22). That is not the same as being ready to take money. Seven of the eight hard requirements are unmet or unverified: there is no recorded restore (and no off-Neon backup), Sentry/uptime/phone alerting are not live, deploy and rollback are not scripted or rehearsed, staging is not evidenced, secrets have not been gitleaks-scanned and rotated, counsel has not approved Terms/Privacy (draft pages plus new-signup checkboxes are not enough), and two High findings remain open (A3-01 restore; A3-03 org cascade only partially flipped). Charging customers on this posture would make a bad migration, a silent 500, or a missing backup a company-ending event instead of an incident.

---

## 1. Hard requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Zero open Critical or High findings after B01–B06 | **UNMET** | All 3 Criticals **Verified**. Highs A3-01 (restore rehearsal) still **open**. High A3-03 (org `onDelete: Cascade`) is **Partially fixed** (AuditLog Restrict only). See §3. |
| 2 | Automated two-tenant isolation suite exists and passes in CI | **MET** (launch subset) | Friday + named cases WH-1, V-01, C-02, O-03, L-02 assert isolation, not smoke (`audit/verification/B05.md`). Adjacent V-02/V-03/C-01/C-03/C-05 also 404. CI **green** on `main` at `db5d9f2` — [Test / Server suite + client build](https://github.com/aupchurch167/proof/actions/runs/35556697178). Residual: full `/audit/tenant-isolation-tests.md` matrix still open (Medium). |
| 3 | Restore from backup performed E2E, with date and measured recovery time; off-Neon backup exists; uploads in object storage | **UNMET** | Uploads **are** on DigitalOcean Spaces (private ACL) — do not move them to the droplet. Restore runbook is still **DRAFT / untested** (`audit/restore-runbook-draft.md` on PR #9). B03 STATUS: “Restore rehearsal / Neon PITR (A3-01) remains owner-owned.” No date, no RTO, no off-Neon dump, no Spaces versioning confirmation anywhere on `main`. |
| 4 | Every secret found in git history has been rotated | **UNVERIFIED → treat as UNMET** | Limited regex scan on 2026-09-20 found **no** live keys in tracked files (`audit/NOTES.md`, A5-05). **gitleaks / trufflehog were never run.** No rotation log. Owner action “install gitleaks and rotate anything it finds” is unchecked. |
| 5 | Error tracking, uptime monitoring, and phone alerting are live | **UNMET** | Sentry **code** is Verified (B05). Live projects/DSNs are owner-created after merge and **are not documented as set**. Until `SENTRY_DSN` / `VITE_SENTRY_DSN` are set, 500s still go to `console.error` / morgan (`audit/findings/new.md`, `B05-STATUS.md`). A6-06 (uptime vendor + phone) is still **Unverified**. Server-checklist boxes for healthcheck / SMS are blank. |
| 6 | Deploy and rollback are scripted and have each been exercised once | **UNMET** | No deploy or rollback script in the repo (no `*.sh`, no workflow beyond `test.yml`). PRs #10–#21 have **prose** rollback notes only. `docs/migrations.md` is migrate-deploy guidance, not a rehearsed cutover. No recorded exercise date for deploy or rollback. |
| 7 | Staging exists and mirrors production config | **UNMET** | A5-04 remains **Unverified**. No `staging.proofcoi.com`, no documented second JWT/Spaces/DB. CORS still includes `https://proof.up.railway.app` (A4-09, owner-confirmed keep — that is not a staging matrix). B03 deploy notes say “Staging first” but do not point at a URL. |
| 8 | Terms and privacy policy are live and acceptance is recorded | **UNMET** | `/terms` and `/privacy` exist and are marked **DRAFT / not counsel-approved**, version `draft-2026-09-21` (B06 Verified). Password + first-time Google signup record acceptance of that **draft**. Existing users and **invitees** keep null columns. Counsel has not replaced the bodies. Not a charging posture. |

**Score: 1 of 8 met. Gate stays closed.**

---

## 2. Unmet hard requirements (owners)

| Unmet # | What is missing | Owner | What “done” looks like |
|---|---|---|---|
| 1 | A3-01 still High: no restore rehearsal, no PITR evidence | **Adam/owner** (+ eng to run the playbook once) | Fill `/audit/restore-runbook-draft.md`. Restore yesterday’s DB to a non-prod URL. Record **date**, operator, and **minutes**. Confirm Spaces objects still sign. |
| 1 | A3-03 still High: only AuditLog is Restrict; other Organization children Cascade | **eng** | Offboarding job + written cascade plan, then flip remaining FKs to Restrict. Today `organization.delete` with no AuditLog still wipes the tenant. |
| 3 | Off-Neon backup + Spaces versioning unknown | **Adam/owner** | Named `pg_dump` or equivalent **outside** Neon, plus Spaces versioning on/off recorded. |
| 4 | gitleaks not run; no rotation record | **Adam/owner** | `gitleaks detect` (laptop + GitHub). Rotate anything found (JWT, Spaces, Resend, Anthropic, Google, DB). Write the date. |
| 5 | Sentry DSNs not evidenced in production | **Adam/owner** | Create projects. Set `SENTRY_DSN` (API) and `VITE_SENTRY_DSN` (SPA **build**). Throw a test 500; event appears. |
| 5 | Uptime check + phone/SMS on 2 failures | **Adam/owner** | 60s probe of `https://app.proofcoi.com/api/health`. Stop the process → page in &lt;5m. Record the vendor. |
| 6 | No deploy/rollback script; never exercised | **eng** (script) + **Adam/owner** (run once on staging/prod) | One scripted path (git SHA → migrate → restart → health) and one scripted rollback. Each run once. Dates in this file. |
| 7 | No staging that mirrors prod | **Adam/owner** | URL + separate JWT secrets, Spaces bucket, and database. Same `NODE_ENV=production` gates. |
| 8 | Counsel-final ToS/Privacy; acceptance of a real version | **counsel** (copy) + **eng** (bump `TERMS_VERSION` / `PRIVACY_VERSION`) + **Adam/owner** (force existing users / invitees) | Live pages without DRAFT banner. New **and** existing users have non-null acceptance of that version. |

---

## 3. Critical / High register after B01–B06

| ID | Title | After V | Still a launch High? |
|---|---|---|---|
| A2-01 | Inbound webhook matches email across orgs | **Verified** (PR #10 / #11) | No. Residual: CC / `additionalEmails` From skipped unless it was `recipientEmail`. |
| A2-02 | Inbound webhook auth optional | **Verified** | No. Residual: Svix skippable when `NODE_ENV` is not exactly `production`. **Owner must set `NODE_ENV=production` and `RESEND_WEBHOOK_SECRET`.** |
| A2-03 | Core mirrors every tenant into one slug | **Verified** | No (latent). Residual: `updateVendor` / `listVendors` / delete helper still use `CORE_ORG_SLUG` without a vendor. **Owner must confirm `HELM_CORE_INTEGRATION` is not `true` unless mapped.** |
| A1-01 | Unrevocable refresh tokens | **Verified** (PR #12 / #14) | No. Residual: 15m access JWT survives logout; `PUT /me` password change does not revoke. |
| A1-02 | `emailVerified` never enforced | **Verified** | No. |
| A1-03 | Google links unverified emails | **Verified** (r2 after send-back PR #13) | No. Residual: case-sensitive email-link lookup can mint a new org. |
| A1-04 | Invite tokens eternal + echoed | **Verified** | No. Residual: plaintext fallback for unexpired legacy rows. |
| A1-05 / A5-01 | JWT/env not fail-loud at boot | **Verified** (B01) | No. Residual: `NODE_ENV` aliases (`prod` / `Production`). |
| A1-13 | Portal JWT verify dead code | **Verified** | No. Residual: pre-B02 UUID tokens 401 until cron / request-coi rotates them. |
| A2-04 | `uploadToken` on GET vendors + usage | **Verified** | No. |
| A2-05 | Apply by UUID, no plan limit | **Verified** | No. Residual: no ADMIN UI to set `Organization.slug`. |
| **A3-01** | **No tested backup/restore** | **Open** (owner) | **Yes.** |
| A3-02 | Vendor delete hard-deletes COIs | **Verified** (PR #15 / #16) | No. Residual: `DELETE /api/cois/:id` still hard-deletes + `deleteFile`; v1 historical + usage COI count include soft-deleted. |
| **A3-03** | **Org Cascade wipes the tenant** | **Partially fixed** | **Yes.** AuditLog Restrict only. |
| A3-04 | In-process cron / no lock | **Verified** | No. Residual: still in-process; no boot catch-up; **pooled Neon URL can break session locks.** |
| A4-01 | Webhook attachment SSRF | **Verified** | No. |
| A4-02 | `http://` outbound webhook SSRF | **Verified** | No. Residual: dispatch allows bracketed IPv6 literals if hand-inserted; no send-time DNS. |
| A6-01 | No Sentry | **Verified** (code, PR #19 / #20) | Code closed. **Live DSN is still an owner gap (hard req 5).** |
| A6-02 | `fetch` without timeout | **Verified** | No. |
| A9-01 | No CI | **Verified** | No. Residual: **required check on `main` is owner-owned** (`gh` 403 from agents). Workflow exists and is green. |
| A10-01 | No ToS/privacy | **Verified** (eng, PR #21 / #22) | Eng closed. **Counsel-final + existing-user acceptance still fail hard req 8.** |
| A10-02 | W-9 tax PII on public apply | **Verified** (eng half) | Public apply blocked. Residual: authenticated W-9, same Spaces prefix / no KMS; **product decision + DPA still open.** |

**Criticals open:** 0.  
**Highs still open or only partial:** A3-01, A3-03.  
**Highs whose eng half is Verified but the hard gate still fails:** A6-01 (not live), A10-01 (draft only).

---

## 4. What B01–B06 closed (PRs #10–#22)

Fix PRs merged to `main`. Verify PRs merged onto the fix branch first, then rode the fix PR in.

| Batch | Fix PR | Verify PR | Merged on `main` | Closed |
|---|---|---|---|---|
| **B01** webhook / Core / SSRF / boot | [#10](https://github.com/aupchurch167/proof/pull/10) | [#11](https://github.com/aupchurch167/proof/pull/11) | `d0e4f71` | A2-01, A2-02, A2-03, A2-08, A4-01, A4-02, A5-01/A1-05, A6-02 |
| **B02** auth / portal / invites / apply | [#12](https://github.com/aupchurch167/proof/pull/12) | [#13](https://github.com/aupchurch167/proof/pull/13) send-back (still Open); [#14](https://github.com/aupchurch167/proof/pull/14) r2 merge | `d7a4398` | A1-01, A1-02, A1-03, A1-04, A1-06, A1-09, A1-10, A1-11, A1-12, A1-13, A2-04, A2-05 |
| **B03** delete / cron / unique / 503 | [#15](https://github.com/aupchurch167/proof/pull/15) | [#16](https://github.com/aupchurch167/proof/pull/16) | `064a1ec` | A3-02, A3-04, A3-07, A3-10, A2-12, A6-04; A3-03 **partial** |
| **B04** input hardening | [#17](https://github.com/aupchurch167/proof/pull/17) | [#18](https://github.com/aupchurch167/proof/pull/18) | `038b4f7` | A4-03, A4-04, A4-05, A4-06, A4-07, A4-08, A4-10, A5-03; A4-09 **Deferred** (Railway CORS keep) |
| **B05** CI / isolation / wipe-guard / Sentry | [#19](https://github.com/aupchurch167/proof/pull/19) | [#20](https://github.com/aupchurch167/proof/pull/20) | `8ddce68` | A9-01, A9-02 (named cases), A9-03, A9-05, A6-01 (SDK) |
| **B06** legal / product honesty | [#21](https://github.com/aupchurch167/proof/pull/21) | [#22](https://github.com/aupchurch167/proof/pull/22) | `db5d9f2` | A10-01 (draft + checkbox), A10-02 (eng half), A8-02, A10-04, A10-05 (draft names processors) |

Latest official suite on the B06 verify SHA: **27 suites / 301 tests**. CI on `main` `db5d9f2`: **success**.

PR #9 (original audit corpus) is **still Open** and remains the source of `audit/backlog.md`, findings A1–A10, the restore draft, and the droplet checklist.

---

## 5. Medium / Low accepted as known risk

These are **not** enough to flip the gate by themselves. They are the residual book after B01–B06. Do not pretend they are closed.

### From original backlog (not in B01–B06, or 90-day)

| ID | Sev | Title | Owner |
|---|---|---|---|
| A1-07 | Medium | Tokens in `localStorage` (no HttpOnly cookies) | eng (90d) |
| A1-08 | Medium | No MFA | Adam/owner + eng (90d) |
| A2-06 | Medium | No Prisma tenant extension / RLS | eng (90d) |
| A2-07 | Medium | VIEWER is not actually read-only on some writes | eng (90d) |
| A2-09 | Medium | User email uniqueness is case-sensitive / identity-split | eng (90d) |
| A2-11 | Medium | `allOrgs` superuser API tokens (Quill custody) | Adam/owner |
| A3-05 | Medium | Outbound webhooks are single-attempt | eng (90d) |
| A3-06 / A10-03 | Medium | No tenant export / DSAR / offboarding | eng (B07+) |
| A3-08 | Medium | Audit holes (vendor PUT, request-coi, apply, settings, …) | eng (90d) |
| A5-02 | Medium | Webhook secrets + invite/reset/verify tokens plaintext at rest | eng (90d) |
| A6-03 | Medium | Unstructured `console` + morgan; emails in logs | eng (90d) |
| A6-05 | Medium | Unpaginated vendors/COIs; reminders N+1 | eng (90d) |
| A6-07 | Low | No `/live` vs `/ready` | eng (90d) |
| A9-04 | Low | No client tests | eng (90d) |
| A10-06 | Low | HIPAA N/A — do not sign a BAA | Adam/owner (keep “No”) |

### Residuals left by Verified batches (accepted)

| Source | Residual | Sev-like |
|---|---|---|
| B01 | Cron / chase / v1 / reject NotificationLogs omit Resend `emailId` (A2-08) | Medium leftover |
| B01 | `/api/webhooks` still in front of the rate limiter | Low / ops |
| B01 | Outbound webhook DNS not re-resolved at send; bracketed IPv6 dispatch | Medium leftover |
| B01 | Non-prod Core still sends `x-helm-test-*` | Ops |
| B02 | Signup body shape still enumerates existing vs new emails | Low |
| B02 | No ADMIN UI for `Organization.slug`; existing slug-less orgs cannot use apply | Low |
| B02 | `SEED_PASSWORD` optional; seed defaults `password123` outside exact `production` | Low (owner: was seed ever run in prod?) |
| B03 | Individual COI DELETE still destroys the PDF | Medium |
| B03 | Vendor unique is exact `(orgId, email)`, not `lower(email)` | Low |
| B03 | Import is per-row, not one CSV transaction | Low |
| B03 | SIGTERM does not wait for an in-flight cron sweep | Low |
| B03 | v1 historical COI list/document still serve soft-deleted rows | Medium leftover |
| B04 | Extract daily cap can overshoot (count-then-insert); scripts without `orgId` skip the cap | Low |
| B04 | 3 `npm audit` highs remain, all `deepmerge-ts` via Prisma CLI (not request path) | Low |
| B04 | Webhook stores non-`%PDF-` attachments (skips extract); reanalyze does not re-check magic | Low |
| B04 | A4-09 Railway CORS **owner-confirmed keep**; CSP `unsafe-inline`; `/api/health` returns `{db}` | Low / Deferred |
| B05 | Full isolation matrix still open | Medium |
| B05 | `cleanupTestData` still truncates everything once the guard passes; `_test` substring | Low / ops |
| B05 | Sentry `beforeSend` does not fully strip request bodies; client scrub thinner than Node | Low |
| B06 | Invitees and existing users have null legal columns | High-adjacent (hard req 8) |
| B06 | Authenticated W-9 still same Spaces prefix / no KMS | High-adjacent (product) |
| B06 | `npm run licenses` does not walk the workspace hoist | Low |
| B06 | Privacy draft does not name optional Sentry | Low |
| B06 | Self-serve billing and per-trade templates still unbuilt (honestly labeled) | Product |

### Unverified owner evidence (still blank)

| ID | Need |
|---|---|
| A3-09 | Neon project + PITR window screenshot / or “not Neon, host is ___” |
| A5-04 | Staging URL or an explicit “none” |
| A6-06 | Uptime vendor + Resend SPF/DKIM/DMARC green |

---

## 6. Owner checklist still open

Copied from PR #9 `audit/backlog.md` “Owner-only” plus B01–B06 deploy notes. **None of these are evidenced as done on `main`.**

| Item | Owner | Why the gate cares |
|---|---|---|
| Run `/audit/server-checklist.md` on the droplet (SSH, ufw, fail2ban, TLS, disk, PM2 count=1 until cron lock is trusted, seed user absent) | **Adam/owner** | Unknown production posture. |
| Confirm `RESEND_WEBHOOK_SECRET` set; process will **exit** in `NODE_ENV=production` without it | **Adam/owner** | A2-02. Unsigned inbound if the string is not exactly `production`. |
| Confirm `HELM_CORE_INTEGRATION` value and `CORE_ORG_MAP` / `CORE_ORG_SLUG` | **Adam/owner** | A2-03 latent dump if the flag is on and unmapped. |
| Confirm `NODE_ENV=production` (not `prod` / `Production`) | **Adam/owner** | Boot + Svix + Core test-header gates are exact-string. |
| Neon PITR window + **restore rehearsal** (date + RTO) | **Adam/owner** | Hard req 3 / A3-01 / A3-09. |
| Off-Neon backup + Spaces versioning | **Adam/owner** | Hard req 3. |
| Point cron/locks at an **unpooled** `DATABASE_URL` (or `DIRECT_URL`) | **Adam/owner** + **eng** | B03 residual: PgBouncer can drop advisory locks. |
| Create Sentry projects; set `SENTRY_DSN` + `VITE_SENTRY_DSN` (never commit) | **Adam/owner** | Hard req 5 / A6-01. |
| Make `Server suite + client build` a **required** status check on `main` | **Adam/owner** | A9-01 residual. Agents get `gh` 403 on branch protection. |
| Counsel-final Terms + Privacy; DPA/SCCs; cookie-banner call | **counsel** | Hard req 8 / A10-01 / A10-05. |
| Bump `TERMS_VERSION` / `PRIVACY_VERSION` and force existing users + invitees | **eng** after counsel | B06 residual. |
| Confirm and publish live subprocessors (Neon vs other Postgres, Helm on/off, Railway vs droplet, optional Sentry) | **Adam/owner** + **counsel** | A10-05. |
| W-9 product decision: when (if ever) public apply may collect; retention; KMS | **Adam/owner** + **counsel** | A10-02 residual. Authenticated upload still live. |
| Uptime 60s + phone/SMS on 2 failures | **Adam/owner** | Hard req 5 / A6-06. |
| Resend SPF / DKIM / DMARC actually passing | **Adam/owner** | A6-06. Vendors never upload if mail is spam. |
| Staging environment yes/no, with its own secrets | **Adam/owner** | Hard req 7 / A5-04. |
| gitleaks on the laptop and GitHub; rotate hits | **Adam/owner** | Hard req 4 / A5-05. |
| Decide: was seed ever run in prod? Rotate that password. Remove `admin@markallancont.com` if present. | **Adam/owner** | A1-10 / server-checklist. |
| MFA / SSO timeline; `allOrgs` token custody for Quill | **Adam/owner** | A1-08 / A2-11. |
| Justify or remove Railway CORS origin | **Adam/owner** | A4-09 keep is recorded; still a second origin. |
| Wire healthcheck → phone (same as uptime row) | **Adam/owner** | Hard req 5. |

---

## 7. What would flip this to GO

All of the following, written down in this file or a dated ops note linked from it — not “we think it’s fine”:

1. A3-01 rehearsal: date, operator, minutes, `prisma migrate diff` clean, one signed COI PDF. Off-Neon dump exists. Spaces versioning recorded.
2. A3-03 either finished (Restrict + offboarding job) or explicitly **accepted in writing** as residual High with a named owner and date — **not** silently dropped.
3. Sentry event from production (or staging that mirrors prod). Uptime vendor named. Phone page tested.
4. Deploy script + rollback script each run once (dates).
5. Staging URL + separate secrets/DB/bucket.
6. gitleaks report empty **or** rotations dated.
7. Counsel-approved `/terms` and `/privacy`; acceptance recorded for anyone who can be billed (including invitees / existing users).
8. Droplet checklist filled; `NODE_ENV=production`; `RESEND_WEBHOOK_SECRET` set; Core flag confirmed; required CI check on `main`.

Until then: **do not charge.** Invoicing an existing friendly tenant as a manual exception is a business call, not an engineering GO.

---

## 8. Re-audit cadence

| When | Why |
|---|---|
| **Quarterly** | Auth, webhooks, cron, and Prisma drift. Re-run the Friday isolation suite plus a restore **touch** (confirm PITR window still on; re-open one signed PDF from a branch). |
| **After any auth, billing, or schema-heavy release** | Same class of bugs B01–B03 fixed (Google link, verify gate, cascade, unique indexes, plan limits). Do not ship those Friday-only. |
| **After turning on Helm Core, a second Node process, or a pooled `DATABASE_URL`** | A2-03 / A3-04 residuals become live. |
| **After counsel replaces legal copy** | Re-check acceptance columns, version lockstep, and subprocessors (include Sentry if DSNs are set). |

Original prefix: `proof-2026-09-20`. Next planned full pass: **2026-12-21** (or sooner if billing/self-serve or a new IdP lands).

---

## 9. Method / what this gate did not do

- Read every `/audit/` file on `main` (STATUS + verification B01–B06, `findings/new.md`).
- Read PR #9 corpus: `backlog.md`, A1–A10, batches B01–B06, restore draft, server-checklist, tenant-isolation matrix, NOTES.
- Did **not** SSH the droplet, open Neon, create a Sentry project, or run gitleaks.
- Did **not** treat PR rollback *notes* as a rehearsed rollback.
- Did **not** treat DRAFT ToS as counsel-approved.
- Did **not** invent owner completions.

Application code was not changed in this review.

---

## 10. Product launch batches (does not open this gate)

Market-readiness follow-on, written 2026-09-26: [audit/launch-batches.md](launch-batches.md) (L01–L14). Security work remains B01–B06. L-series is product work (compliance switches, terms acceptance mechanism, billing, then support, exports, roles, offboarding, mail reliability, help, per-trade templates). L14 (agent portal / referrals) is post-launch. Owner/ops items in that file stay outside those PRs. **This gate stays NO-GO** until section 7 is met. Shipping an L batch is not a GO.
