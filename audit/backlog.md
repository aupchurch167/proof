# Triage backlog — `proof-2026-09-20`

Merged from A1–A10. Duplicates collapsed. Severities challenged in the notes column. **Do not implement from this file until Prompt F.**

## Counts (unique work items after merge)

| Severity | Unique items | Notes |
|---|---|---|
| Critical | 3 | A2-01, A2-02, A2-03 (03 latent if flag off) |
| High | 18 | includes durability + legal + CI |
| Medium | 24 | |
| Low | 10 | |
| Unverified | 3 | owner evidence needed |

Raw finding IDs written: 3 Critical + 18 High + 24 Medium + 10 Low + 3 Unverified = 58 line items across A1–A10, of which ~8 are cross-references merged below.

## Drop / do-not-fix

| ID | Why |
|---|---|
| A7 | No billing. Skip. |
| A8-01 | Meta of other IDs — track those, not this. |
| A2-10 | Client AdminRoute gap is UX; server already authorizes writes. |
| A10-06 | HIPAA does not apply; keep the “No” answer, no eng work. |
| A5-05 (finding of “no secrets found”) | Informational. Action is “run gitleaks,” not a product bug. |

## Severity challenges

| ID | Written | After triage | Why |
|---|---|---|---|
| A2-03 | Critical | **Critical (latent)** | Code will exfiltrate all tenants if the flag is on. If owner confirms flag is false in prod, treat as High hardening until launch anyway (default must stay off + gated). |
| A1-02 | High | High | Own empty tenant + email squatting, not cross-tenant read. Not Critical. |
| A2-04 | High | High | Intra-tenant privilege via portal, not IDOR across orgs. |
| A4-06 nodemailer | Medium | **Low** | Package unused. Keep the rest of A4-06 (rate-limit / form-data) Medium. |
| A9-01 | High | High | Isolation tests exist and are worthless without CI. |
| A3-02 | High | High | MEMBER hard-deletes the product (PDFs). |
| A10-02 | High | High | W9 = TIN/SSN on the same path as public apply. |
| A1-08 MFA | Medium | Medium | Not a launch blocker if passwords + Google + short access TTL; 90-day. |
| A6-01 Sentry | High | High | Single-process SaaS with console.log only is not operable. |

## Unique work items

### Critical — ship-stoppers

| ID | Title | Effort | Batch |
|---|---|---|---|
| A2-01 | Inbound webhook matches vendor email across all orgs | M | B01 |
| A2-02 | Inbound webhook auth optional | S | B01 |
| A2-03 | Core mirror all tenants → one slug | S | B01 |

### High

| ID | Title | Effort | Batch |
|---|---|---|---|
| A1-01 | Unrevocable refresh tokens | M | B02 |
| A1-02 | emailVerified never enforced | S | B02 |
| A1-03 | Google links unverified emails | S | B02 |
| A1-04 | Invite tokens eternal + echoed | S | B02 |
| A1-05 / A5-01 | JWT/env not fail-loud at boot | S | B01 |
| A1-13 | Portal JWT verify dead code | S | B02 |
| A2-04 | uploadToken on GET vendors + usage | S | B02 |
| A2-05 | Apply by UUID, no plan limit | S | B02 |
| A3-01 | No restore rehearsal | M | owner + B03 |
| A3-02 | Vendor delete hard-deletes COIs | M | B03 |
| A3-03 | Org cascade | L | B03 (schema, careful) |
| A3-04 | In-process cron / no lock | M | B03 |
| A4-01 | Webhook attachment SSRF | S | B01 |
| A4-02 | http:// outbound webhook SSRF | S | B01 |
| A6-01 | No Sentry | S | B05 |
| A6-02 | fetch without timeout | S | B01 |
| A9-01 | No CI | S | B05 |
| A10-01 | No ToS/privacy | S | B06 + owner |
| A10-02 | W9 tax PII controls | M | B06 |

### Medium (launch-week if cheap; else 90 days)

| ID | Title | Effort | Batch |
|---|---|---|---|
| A1-06 | Signup/invite email enum | S | B02 |
| A1-07 | localStorage tokens | M | 90d |
| A1-08 | MFA | L | 90d |
| A1-09 | Accept-invite emailVerified | S | B02 |
| A1-11 | PUT /me skips zod | S | B02 |
| A2-06 | Prisma tenant extension / RLS | L | 90d |
| A2-07 | VIEWER not actually read-only | M | 90d |
| A2-08 | Bounce matches email globally | M | B01 |
| A2-09 | Global unique user email | L | 90d |
| A2-11 | allOrgs superuser ops | M | owner doc |
| A2-12 | Vendor (orgId,email) unique | S | B03 |
| A3-05 | Webhook retry | M | 90d |
| A3-06 / A10-03 | Export / offboarding | L | 90d |
| A3-07 | Import tokens + transactional delete | S | B03 |
| A3-08 | Audit coverage holes | M | 90d |
| A3-10 | Plan limit fail-open | S | B03 |
| A4-03 | Email HTML escape | S | B04 |
| A4-04 | LLM spend cap | M | B04 |
| A4-05 | zod gaps | M | B04 |
| A4-06 | npm audit (non-nodemailer) | S | B04 |
| A4-07 | PDF magic bytes | S | B04 |
| A4-08 | export-pdfs cap | S | B04 |
| A5-02 | Hash webhook/user tokens at rest | M | 90d |
| A6-03 | Structured logs | M | 90d |
| A6-04 | Stop cron on shutdown | S | B03 |
| A6-05 | Paginate vendors/cois | M | 90d |
| A8-02 | Hide stubbed settings | S | B06 |
| A9-02 | Two-tenant session tests | M | B05 |
| A9-03 | portal.test.js 401 vs 404 | S | B05 |
| A9-05 | cleanupTestData wipe | S | B05 |
| A4-06 nodemailer unused | Remove dep | S | B04 |

### Low

| ID | Title | Batch |
|---|---|---|
| A1-10 | Seed password guard | B02 |
| A1-12 | Pin jwt algorithms | B02 |
| A4-09 | CSP / health / Railway CORS | B04 |
| A4-10 | notifications parseLimit | B04 |
| A5-03 | gitignore .env.* | B04 |
| A6-07 | /live vs /ready | 90d |
| A9-04 | Client tests | 90d |
| A10-04 | LICENSE + notice | B06 |
| A10-05 | Cookie/GIS disclosure in privacy | B06 |

### Unverified (owner)

| ID | Need |
|---|---|
| A3-09 | Neon PITR screenshot / host name |
| A5-04 | Staging URL or “none” |
| A6-06 | Uptime vendor + Resend DNS green |

## Owner-only (engineering cannot close)

1. Run `/audit/server-checklist.md` on the droplet.
2. Confirm `RESEND_WEBHOOK_SECRET` set; `HELM_CORE_INTEGRATION` value; `NODE_ENV=production`.
3. Confirm database host + PITR; rehearse `/audit/restore-runbook-draft.md`.
4. Counsel: ToS, privacy, subprocessor list, W9 retention.
5. Remove or justify `https://proof.up.railway.app` CORS.
6. Decide: seed ever run in prod? Rotate that password.
7. MFA / SSO timeline; allOrgs token custody for Quill.
8. Install gitleaks on the laptop and GitHub.
9. Wire healthcheck → phone.
10. Staging environment yes/no.

## Suggested order

B01 (webhook/Core/SSRF/boot) → B02 (authn + portal tokens) → B03 (delete/cron/unique) → B05 (CI + isolation tests so B01/B02 stay fixed) → B04 (input polish) → B06 (legal/product copy). 90-day items stay out of B01–B06.
