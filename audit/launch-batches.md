# Launch batches (L-series)

**Date:** 2026-09-26  
**Status:** plan only. No product code in this document’s PR.  
**Source:** market-readiness review of `main` at `c5c3691`, plus the charging gate in `audit/release-gate.md` (NO-GO, 2026-09-21, SHA `db5d9f2`).  
**Numbering:** security batches on `main` stop at **B06** (`audit/batches/B06-STATUS.md`). B06 status used “B07+” as a loose label for tenant export / offboarding. This series does **not** reuse B07. Product work is **L01+** so it cannot be confused with B01–B06.

This plan does not close the release gate. Merging a later billing PR is not permission to charge. Owner/ops items at the bottom stay outside these PRs.

Each batch is one pull request. Do them in number order unless a batch says it has no dependency. L14 is post-launch and is not scheduled.

---

## L01 — Requirements settings drive compliant / not compliant

**Goal.** The badge a contractor trusts follows every Requirements control that looks live today: optional coverage lines, “certificate holder must match,” and “expiring within N days.” Soft-deleted certificates stop counting toward the plan cap.

**Scope.**

- Optional lines. `checkCompliance` in `server/src/services/compliance.js` flags a blank amount as `MISSING` even when the stored minimum is `0`. `coverage.js` already treats a minimum of `0` as not required (`verdict: skipped`). Make the status check use that same rule. A required line (minimum above zero) that is missing or short still fails. `updateVendorStatus` must not set `NON_COMPLIANT` for a skipped line.
- Holder match. `OrganizationSettings.requireHolderMatch` is saved by `server/src/routes/requirements.js` and is not read by `checkCompliance`. When the switch is on, a missing holder name or a name that does not match the organization fails compliance. When it is off, do not flag holder mismatch and do not fail status for it. Today a mismatch flag is written whenever both names exist, and `updateVendorStatus` ignores that flag type, so the switch does nothing either way.
- Warn-at-N-days. `expiringWindowDays` is saved and ignored. Status, coverage chips, API “expiring soon,” the compliance overview, and the weekly summary’s “within 30 days” bucket all hardcode 30 (`server/src/services/coverage.js`, `compliance.js`, `complianceOverview.js`, `server/src/http/serializers.js`, the `days <= 30` branch in `server/src/services/cron.js`). Use the saved window. `0` means do not use `EXPIRING_SOON` (a date already past is still `EXPIRED`). This is not the reminder schedule. `reminderDaysBefore` on the Reminders screen stays as it is.
- `warnInPeriod` and `retainForPeriod` are already labeled stored-not-enforced in `client/src/pages/Requirements.jsx`. Leave that copy. Do not enforce them here.
- After the rule change, recompute `Vendor.coiStatus` for existing rows with a one-off script (deploy note: run once). Do not do it on every boot.
- Plan cap. `evaluatePlanLimit` in `server/src/middleware/planLimits.js` counts certificates with `prisma.coi.count({ where: { orgId } })` and does not exclude `deletedAt`. Vendor counts already exclude soft-deleted vendors. Count only `deletedAt: null`. Portal, apply, import, and staff upload share this helper.

**Files likely touched.** `server/src/services/compliance.js`, `coverage.js`, `complianceOverview.js`, `cron.js` (expiring-soon bucket only), `server/src/http/serializers.js`, `server/src/middleware/planLimits.js`, `client/src/pages/Requirements.jsx` (say the holder switch and the day window are enforced; do not relabel the two already-honest toggles), `server/scripts/recompute-vendor-status.js` (new). Tests: `server/tests/compliance.test.js`, `coverage.test.js`, `vendors.test.js`, `b03-delete-cron-unique.test.js`, `screens-api.test.js`, apply plan-limit cases in `b02-auth-portal.test.js`.

**Migration.** No.

**Tests.** Optional line does not fail the vendor. Required line still fails when missing or short. Holder mismatch fails only when the switch is on; a blank holder fails only when it is on. Window of 14 vs 45 changes who is `EXPIRING_SOON`. Window of 0 does not. A soft-deleted certificate does not consume `maxCois`. Existing cap tests still pass.

**Out of scope.** Per-trade templates (L13). Reminder-day emails. `warnInPeriod` / `retainForPeriod`. Hard-delete of a single certificate (L10). Stripe.

**Dependencies.** None. L13 must not start before this merges.

---

## L02 — Terms and privacy acceptance for everyone who can be billed

**Goal.** Record the accepted terms version and privacy version for every user who can use a billable company, including people invited later and people already in the database. When `TERMS_VERSION` or `PRIVACY_VERSION` changes, the next login asks again. Do not change lawyer-facing prose.

**Scope.**

- Columns already exist (`termsAcceptedAt`, `termsVersion`, `privacyAcceptedAt`, `privacyVersion` on `User`, migration `20260921000000_add_legal_acceptance`). Password signup and first-time Google signup already write them (`server/src/routes/auth.js`). Login, returning Google sign-in, and accept-invite leave them null (B06 residual).
- Add `POST /api/auth/accept-legal` for a logged-in user. It requires the same strict `acceptTerms` check signup uses and writes the current versions from `server/src/legal/documents.js` (keep lockstep with `client/src/legal/documents.js`).
- Product routes that already require a verified email return `403` with `LEGAL_ACCEPTANCE_REQUIRED` when either version is null or is not the current string. Allow accept-legal, logout, `/me`, resend-verification, and the public `/terms` and `/privacy` pages.
- Client: a blocking screen after login with links to the existing draft pages and one checkbox. No new legal paragraphs.
- `POST /api/auth/accept-invite` requires acceptance and stores the versions. Pending invitees are not billed until they join; once they join, they are covered.
- Do not bump `draft-2026-09-21` in this PR. Null versions are the first prompt. A later counsel bump of the version constants re-prompts everyone without another mechanism change.

**Files likely touched.** `server/src/routes/auth.js`, `server/src/middleware/auth.js` (or a small `requireCurrentLegal` helper next to it), `client/src/App.jsx`, `client/src/pages/Login.jsx`, `AcceptInvite.jsx`, a small gate component under `client/src/components/`. Tests: `server/tests/b06-legal-product.test.js`, `auth.test.js`, `google-auth.test.js`.

**Migration.** No.

**Tests.** Login with null versions can call accept-legal and then a normal route. Mismatched version gets 403 until accept. Accept-invite without the checkbox is 400 and creates no usable session. Signup still stores versions. Omitting acceptance does not write a user on invite. Version constants are not edited.

**Out of scope.** Replacing draft terms, privacy, DPA, or cookie-banner copy. W-9 policy. Forcing a version bump.

**Dependencies.** None. Counsel-approved text is an owner item; this PR only builds the gate those versions will trip.

---

## L03 — Plan prices, Stripe Checkout, subscription state

**Goal.** Prices live in config. An admin can start Checkout for Starter or Unlimited. Paid plan and subscription status change only when a verified Stripe webhook says so.

**Scope.**

- Add monthly USD amounts, in cents, next to the existing caps in `server/src/config/plans.js`. Free is `$0` and has no Checkout. Do not invent Starter or Unlimited dollar amounts in code review; the PR adds the fields and Checkout stays off until the owner commits the numbers (see owner list). `BILLING_ENABLED` must be exactly `true` or checkout and billing routes respond `404` and Settings keeps today’s “Invoiced · not self-serve” copy (`client/src/pages/Settings.jsx`).
- Schema on `Organization`: `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialEndsAt` (column reserved for L04). New `StripeEvent` table (`eventId` unique) so retries do not apply twice.
- `POST /api/billing/checkout` (admin, verified, current legal acceptance): Stripe Checkout for `STARTER` or `UNLIMITED` only. Create the Stripe customer on first use and store the id.
- `POST /api/webhooks/stripe`: raw body, signature check, mounted like the Resend hook (before the JSON parser). Handle `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Map active/trialing subscription price to `Organization.plan`. The success URL must not set the plan.
- Ignore webhooks for unknown customers. Do not log full payloads.

**Files likely touched.** `server/src/config/plans.js`, `server/prisma/schema.prisma`, a new migration, `server/src/routes/billing.js`, `server/src/app.js` (mount webhook with raw body), `server/.env.example` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_ENABLED`), `client/src/pages/Settings.jsx` (upgrade buttons only when the flag is on). New tests under `server/tests/`.

**Migration.** Yes. Additive columns and `StripeEvent`. Existing orgs stay Free with null Stripe ids.

**Tests.** Bad signature is 400. Replayed `eventId` does not double-write. `subscription.updated` sets plan and status. `invoice.payment_failed` records the failed status and does not delete vendors, certificates, or files. Non-admin cannot open checkout. Flag off returns 404. Success redirect alone does not change `plan`.

**Out of scope.** Customer portal, trials, read-only lapse, staff plan override (L04 and L05). Receipts UI. Changing caps.

**Dependencies.** Owner price decision before `BILLING_ENABLED=true` in production. Code can merge with the flag off. Stripe account, keys, and webhook endpoint are owner/ops.

---

## L04 — Billing portal and optional trial

**Goal.** An admin can open Stripe’s customer portal to cancel, update the card, and open invoices and receipts. A trial length can be turned on in config without a second payment integration.

**Scope.**

- `POST /api/billing/portal-session` (admin) returns the Stripe Billing Portal URL. Cancel, payment-method update, and invoice history are the portal, not custom screens. Portal configuration (what the customer is allowed to do) is set in the Stripe dashboard; say that in the deploy note.
- `trialPeriodDays` in `server/src/config/plans.js`, default `0`. Checkout passes `subscription_data.trial_period_days` only when it is greater than zero. Webhooks already map `trialing` (L03). While `trialing`, the org keeps the paid plan’s caps. When the trial ends without a paid invoice, Stripe sends `subscription.updated` / `deleted`; L05 enforces read-only from that status. This PR does not lock the account.
- Settings: “Manage billing” when a `stripeCustomerId` exists. No local receipt table.

**Files likely touched.** `server/src/config/plans.js`, `server/src/routes/billing.js`, `client/src/pages/Settings.jsx`, billing tests.

**Migration.** No, if L03 already added `trialEndsAt`. If that column was skipped, add it here.

**Tests.** Portal route requires admin and a Stripe customer. `trialPeriodDays` of 0 omits a trial on the Checkout payload (assert the parameter, mock Stripe). Non-zero trial is sent and `trialing` still maps to the paid plan via the L03 webhook handler.

**Out of scope.** Custom invoice PDF renderer. Dunning email copy beyond what Stripe sends. Lapse lock (L05). Staff overrides.

**Dependencies.** L03. Owner chooses trial days (0 means no trial) before enabling billing.

---

## L05 — Lapse is read-only; staff can set a plan

**Goal.** A failed or ended subscription can still be logged into and read. It cannot be written. Nothing deletes vendors, certificates, or stored PDFs because a card failed. A staff person can change `Organization.plan` without opening the database.

**Scope.**

- Read-only when `subscriptionStatus` is `past_due`, `unpaid`, `canceled`, `incomplete_expired`, or `paused`. Also when status is `active` or `trialing` but `currentPeriodEnd` is in the past (clock skew safety). Free orgs with a null subscription are not read-only. `cancelAtPeriodEnd` stays fully usable until the period end, then the webhook’s `canceled` status locks writes.
- Middleware on mutating `/api` routes: `403` `BILLING_READ_ONLY`. Allow GET, logout, accept-legal, billing portal session, and checkout (so they can pay). Block vendor create, import, upload, approve, reject, invite, settings writes, and deletes. Do not call `deleteFile` or `prisma.*.delete` from this path.
- Banner in the app shell with the portal link (L04) when billing is enabled.
- Staff plan change: `STAFF_EMAILS` (comma-separated, server env). `POST /api/staff/organizations/:id/plan` with `{ plan, reason }` from a user whose email is on that list. Writes `plan`, writes an `AuditLog` row (`staff_set_plan`) on that org, and does not call Stripe. If `stripeSubscriptionId` is set and status is `active` or `trialing`, refuse unless the body sets `detachStripe: true` (clears Stripe ids on our row only; it does not cancel Stripe). That avoids the next webhook undoing a comp.
- No staff UI in this PR (L06).

**Files likely touched.** `server/src/middleware/billingAccess.js` (new), route mounts in `server/src/app.js` or per-router, `server/src/routes/staff.js` (new), `client/src/components/Layout.jsx` or a banner component, `server/.env.example`, tests.

**Migration.** No.

**Tests.** `past_due` can GET a vendor and cannot POST one. No storage delete. Free org unchanged. Staff email can set `UNLIMITED` and an audit row exists. Other admins get 403. Active Stripe subscription without `detachStripe` is 409.

**Out of scope.** Grace period longer than “lock on `past_due`.” Automatic Spaces cleanup. The staff console UI. Refunds.

**Dependencies.** L03. Portal link in the banner needs L04; if the portal route is missing, the banner still explains read-only and does not 500.

---

## L06 — Support console

**Goal.** Staff can find a company, see its plan and subscription status, set the plan, see its users, and resend an invite, from a screen that customers never see.

**Scope.**

- Route `/staff`, hidden from `client/src/components/Layout.jsx`. Same `STAFF_EMAILS` gate as L05, enforced on the server.
- Search organizations by name or account email. Show plan, subscription status, period end, user list, vendor count.
- “Set plan” calls the L05 route. Resend invite reuses the existing invite token flow (`server/src/routes/users.js`).
- No impersonation, no refunds, no editing a customer’s vendors.

**Files likely touched.** `client/src/pages/Staff.jsx` (new), `client/src/App.jsx`, `server/src/routes/staff.js`, staff tests.

**Migration.** No.

**Tests.** Non-staff get 403 on list and on set-plan. Staff search does not return another request’s vendors in the list payload beyond counts. Resend invite does not echo the raw token in the JSON body (email only).

**Out of scope.** Impersonation. Stripe refunds. A public help desk.

**Dependencies.** L05.

---

## L07 — Audit CSV and audit-packet PDF

**Goal.** The audit screen’s export buttons download real files for the signed-in user.

**Scope.**

- `client/src/pages/Audit.jsx` “Export CSV” is a plain link to `/api/reports/cois?format=csv`. That handler ignores `format` and returns JSON (`server/src/routes/reports.js`), and a raw link does not send the bearer token. Fetch with the API client and download a CSV blob (vendor, submitted date, status, four limits, four expirations, agent email). Server may also honor `format=csv` with `text/csv` if the client calls it with auth. Do not leave the naked anchor.
- “Export audit packet” currently only fires a toast that the PDF merge is not wired. `POST /api/reports/export-pdfs` already merges up to 50 PDFs. Pass the certificate ids for the coverage range on screen. If the range has more than 50, say so and do not silently drop the rest. Remove the toast-only button.
- Leave `client/src/pages/Reports.jsx` unrouted. Do not add a second reports page.

**Files likely touched.** `client/src/pages/Audit.jsx`, `server/src/routes/reports.js`, `server/tests` for CSV auth and the 50-id cap.

**Migration.** No.

**Tests.** CSV request without a token is 401. With a token, body is CSV and includes a known vendor. 51 ids is 400. Packet request does not include a soft-deleted certificate.

**Out of scope.** Emailing the packet. A new report builder.

**Dependencies.** None. Safe to build beside L01; it does not change status rules.

---

## L08 — Reviewer, Viewer, and ownership transfer

**Goal.** An admin can assign Reviewer and Viewer, Viewer cannot change data, and ownership can move to another admin so the founder is not stuck.

**Scope.**

- `UserRole` already includes `REVIEWER` and `VIEWER` (`schema.prisma`). Invite and role change only allow `ADMIN` and `MEMBER` (`server/src/routes/users.js`, `client/src/pages/Users.jsx`). Add the two roles to invite and to the role dropdown.
- Viewer: every mutating route returns 403. Close the holes where a route only calls `authenticate` and then writes (the known A2-07 residual). Reviewer keeps approve, reject, request-COI, and upload. Reviewer does not invite, change billing, change requirements, or delete vendors. Match the `authorize(...)` lists that already exist; do not widen them.
- Ownership: `POST /api/users/:id/transfer-ownership`. Caller must be admin. Target must already be in the org and not a pending invite. Target becomes `ADMIN`, caller becomes `MEMBER`, and the org still has at least one admin. Audit log the transfer. Caller cannot transfer to themselves.
- Last-admin delete and demote rules stay.

**Files likely touched.** `server/src/routes/users.js`, mutating routers under `server/src/routes/` (authorize Viewer), `client/src/pages/Users.jsx`, `Settings.jsx` team list, tests in `server/tests/` (new role cases; extend `screens-api` or users tests).

**Migration.** No.

**Tests.** Invite as Viewer, Viewer POST vendor is 403, Viewer GET vendor is 200. Reviewer can approve and cannot invite. Transfer swaps roles. Transfer to a pending invite is 400. Last admin still cannot be removed.

**Out of scope.** Multiple companies per user. SSO. MFA.

**Dependencies.** None.

---

## L09 — Data export and company deletion

**Goal.** An admin can download the company’s data and can delete the company on purpose. Deletion must not be `prisma.organization.delete()` while child foreign keys cascade (A3-03). Stored PDFs are not wiped in the same click.

**Scope.**

- This is the export / offboarding item B06 status called “B07+” (`audit/batches/B06-STATUS.md`, findings A3-06 / A10-03).
- `GET /api/organization/export` (admin): JSON of organization profile, users without password hashes or tokens, vendors, certificate field data, and notification metadata. Include object keys and short-lived signed URLs for PDFs, W-9s, and master agreements. Do not build one giant zip in memory.
- `POST /api/organization/delete` (admin) with the company name typed back. Explicit ordered deletes in a transaction: sessions, then users (clear `Coi.reviewedById` first), vendors, certificates, notifications, API clients, webhook endpoints. Do not rely on `onDelete: Cascade`. `AuditLog` is `onDelete: Restrict`; copy a deletion record (who, when, object keys) and then remove or detach audit rows so the org row can go. New `OrganizationDeletion` table holds that record after the org row is gone.
- Do not call `deleteFile` in this request. The deletion row is the list ops would use for a later purge. Say that in the confirm dialog: database access ends, files remain until a separate ops purge.
- Revoke sessions before removing users.

**Files likely touched.** `server/src/routes/organization.js`, `server/prisma/schema.prisma`, new migration, `client/src/pages/Settings.jsx` (export and delete, behind a typed confirm), tests.

**Migration.** Yes (`OrganizationDeletion`).

**Tests.** Export omits `passwordHash` and invite token hashes. Delete of org A leaves org B intact. Delete does not call `deleteFile`. A second delete is 404. Typed name mismatch is 400. Cascade is not the mechanism (assert children are gone and a deletion row lists keys).

**Out of scope.** Flipping every Organization foreign key to Restrict (the rest of A3-03). Automatic Spaces purge. A 30-day undo UI.

**Dependencies.** None required. Do not implement this by calling `organization.delete()`.

---

## L10 — Deleting one certificate keeps the file

**Goal.** Removing a single certificate hides it and leaves the PDF in storage.

**Scope.**

- `DELETE /api/cois/:id` in `server/src/routes/cois.js` currently `deleteFile`s the PDF and `prisma.coi.delete`s the row (B03 residual in `audit/findings/new.md`). Set `deletedAt` instead. Do not call `deleteFile`.
- Customer lists already filter `deletedAt`. Public API historical certificates and the document URL must not return a soft-deleted row (`server/src/routes/v1/cois.js` and the vendor document route). That residual is called out in the release gate (B03: v1 historical still serves soft-deleted rows).
- Recompute that vendor’s status after the hide.
- Vendor delete already soft-deletes certificates and keeps files. Do not change that.

**Files likely touched.** `server/src/routes/cois.js`, `server/src/routes/v1/cois.js`, v1 vendor document handler, `server/tests/cois.test.js`, `server/tests/api-v1.test.js`, `b03-delete-cron-unique.test.js`.

**Migration.** No. `Coi.deletedAt` already exists.

**Tests.** Delete returns success, row still exists with `deletedAt` set, storage delete is not called, GET list hides it, v1 historical and document return 404 for that id, vendor status updates.

**Out of scope.** A restore button. Spaces versioning (owner/ops). Plan-cap math (L01).

**Dependencies.** L01 should merge first so a hidden certificate is not still eating the cap. The delete change itself does not require L01’s code.

---

## L11 — Reminder and email reliability

**Goal.** Scheduled mail runs in a timezone the owner chose, a second app process cannot double-send, and a missing mail key is not stored as a successful send.

**Scope.**

- `CronJob` in `server/src/services/cron.js` has no `timeZone` (8:00 and 9:00 are server-local). Pass `timeZone: process.env.CRON_TIMEZONE`. In production, boot fails when it is unset (`server/src/config/env.js`). In non-production, default `UTC` and log that once.
- Single runner: `server/src/lib/advisoryLock.js` already uses `pg_try_advisory_lock` on a dedicated `pg` client. Point that client at `DIRECT_URL` when set, otherwise `DATABASE_URL`. If the lock connection errors, the sweep throws and sends nothing. If the lock is not acquired, return without sending (already the shape). Do not add a second lock library. Deploy note: a pooled Neon URL is not a valid lock connection (release-gate residual).
- `sendEmail` in `server/src/services/email.js` returns without throwing when `RESEND_API_KEY` or `FROM_EMAIL` is missing, and `POST /api/vendors/:id/request-coi` still writes `NotificationLog` `SENT`. Throw a typed error instead. Callers write `FAILED` or respond `503` `EMAIL_NOT_CONFIGURED` and do not write `SENT`. Same for cron expiration, chase, and weekly summary.
- Where those callers are already being edited, store the Resend id in `meta.emailId` (B01 residual: several sweeps omit it). Do not redesign bounce handling.

**Files likely touched.** `server/src/services/cron.js`, `email.js`, `server/src/lib/advisoryLock.js`, `server/src/config/env.js`, `server/src/routes/vendors.js` (request-coi), invite and reject send sites if they mark `SENT` the same way, `server/.env.example`, `server/tests/reminders.test.js`, `chase.test.js`, vendors request tests.

**Migration.** No.

**Tests.** Unconfigured Resend: request-coi is 503 and the log row is not `SENT`. Configured send still stores `emailId` when the provider returns one. Lock not acquired: zero sends. `CRON_TIMEZONE` missing in production fails `validateEnv`.

**Out of scope.** Moving cron to a separate worker service. Catch-up for a missed 8:00 tick beyond what the window logic already does. SPF/DKIM/DMARC (owner).

**Dependencies.** None. Production still needs the owner mail DNS items or this only stops false “sent” rows.

---

## L12 — First-run help and a support contact

**Goal.** A new company sees the next step on an empty dashboard, and the app shows a real support address instead of “contact us” with nowhere to write.

**Scope.**

- `SUPPORT_EMAIL` in server and `VITE_SUPPORT_EMAIL` in the client. Show a mailto in Settings, the sidebar footer, and the billing read-only banner if that banner exists. If the variable is empty, hide the link. Do not hardcode an address.
- `/help`: one page in the app (add a vendor, request a certificate, approve, set requirements), linked from the sidebar. Not a marketing site and not a chat widget.
- Dashboard when the vendor count is 0: short checklist (add or import vendors, confirm requirements, invite a teammate) using the empty-state component that already exists. Do not seed sample vendors.

**Files likely touched.** `client/src/pages/Dashboard.jsx`, `Help.jsx` (new), `Layout.jsx`, `Settings.jsx`, `client/src/App.jsx`, `client/.env.example`, `server/.env.example`.

**Migration.** No.

**Tests.** Client build. If a server route exposes the address, assert it echoes env and is absent when unset. No new legal paragraphs.

**Out of scope.** Intercom or other in-app chat. Marketing site. Changing `/terms` or `/privacy` bodies.

**Dependencies.** None. `SUPPORT_EMAIL` value is owner/ops.

---

## L13 — Per-trade requirement templates

**Goal.** A company can have more than one requirement template and assign it by trade. “New template · Coming soon” becomes a real button.

**Scope.**

- New `RequirementTemplate` model: org, name, trades (string list; empty means default for everyone else), the four minimums, `requireHolderMatch`, `expiringWindowDays`. One default per org.
- Migration backfills one default row from `OrganizationSettings`.
- Status from L01 resolves the vendor’s trade to a template, otherwise the default. Do not keep a second copy of the pass/fail rules.
- `multiTemplateSupported: true` and enable the button in `client/src/pages/Requirements.jsx`. `PUT /api/requirements/:templateId` accepts real ids, not only `"default"`.
- Changing a template recomputes vendors on that trade (same idea as today’s “every vendor re-checked”).

**Files likely touched.** `schema.prisma`, new migration, `server/src/routes/requirements.js`, `server/src/services/compliance.js`, `coverage.js`, `client/src/pages/Requirements.jsx`, `server/tests/screens-api.test.js`, compliance tests.

**Migration.** Yes, plus backfill.

**Tests.** Two templates: an electrical vendor uses the electrical minimums; a vendor with no matching trade uses the default. Holder and day-window behavior from L01 still apply on the chosen template. Second default is rejected.

**Out of scope.** Templates per project or job site. `warnInPeriod` / `retainForPeriod` enforcement.

**Dependencies.** L01.

---

## L14 — Agent portal and referral tracking (post-launch)

**Not a launch batch.** Do not open this PR until L01–L05 are in production and the owner asks for it.

**Why it waits.** There is no agent login, no referral code, and no commission ledger. `agentName` / `agentEmail` / `agentPhone` are fields read off a certificate (`schema.prisma`, extractor, COI detail). Requests email the vendor and `additionalEmails`, not the agent. Building this before billing and honest compliance checks would ship a second product.

**Later scope, when scheduled.** A token link for the agent to upload on behalf of a vendor. Optional referral code on signup. A ledger of referred orgs and a status the staff console can see. No payout automation until finance defines rates.

**Migration.** Decide at that time. Not now.

**Dependencies.** Owner product decision. L06 if staff must see referrals. Not a blocker for charging.

---

## Suggested order

| Order | Batch | Blocks charging? |
|---|---|---|
| 1 | L01 compliance honesty and plan cap | Yes, if you sell “we check your requirements” |
| 2 | L02 acceptance mechanism | Yes, together with counsel text (owner list) |
| 3 | L03 checkout and webhooks | Yes, the flag stays off until prices and the gate allow it |
| 4 | L04 portal and trial | Yes, customers need cancel, card update, and receipts |
| 5 | L05 read-only lapse and staff plan change | Yes, lapse must not delete files |
| 6–12 | L06 through L12 | No, unless a pilot hits that gap |
| 13 | L13 per-trade templates | No |
| — | L14 agent / referrals | Post-launch |

L07, L08, L10, L11, and L12 may proceed in parallel with billing once their own dependencies are met. L13 waits on L01. L14 waits on an explicit owner go.

---

## Owner / ops only (not these PRs)

These stay unmet until the owner records them. Engineering batches must not pretend they are done.

| Item | Needed before |
|---|---|
| Starter and Unlimited monthly prices, and trial days (0 or a number) | Turning `BILLING_ENABLED` on |
| Stripe account, live secret key, webhook signing secret, portal settings in the Stripe dashboard | L03 / L04 in production |
| `STAFF_EMAILS` and `CRON_TIMEZONE` | L05 / L06 and L11 in production |
| `SUPPORT_EMAIL` | The help link showing a real inbox |
| Counsel-approved Terms and Privacy; then bump `TERMS_VERSION` and `PRIVACY_VERSION` (L02 will re-prompt) | Charging. Draft pages are not enough |
| DPA / SCCs and the W-9 decision (public apply stays blocked until then) | Collecting W-9s on the public form |
| Cookie-banner decision | Counsel, not an L batch |
| Restore rehearsal with a date and minutes, plus a backup that is not only the database host | Release gate hard requirement 3 |
| Spaces versioning on or off, written down | Release gate hard requirement 3. L10 keeps the object; versioning is bucket config |
| Sentry DSNs (`SENTRY_DSN`, `VITE_SENTRY_DSN`) and one test event | Release gate hard requirement 5 |
| Uptime check and phone alert | Release gate hard requirement 5 |
| Resend SPF, DKIM, and DMARC actually passing | Vendors receiving upload links |
| Resend inbound route and `RESEND_WEBHOOK_SECRET` with `NODE_ENV=production` | Email-in certificates |
| Unpooled database URL for cron locks (`DIRECT_URL`) | L11’s lock being real on Neon |
| Marketing site and DNS for proofcoi.com (this repo’s `nginx/proof.conf` sends the apex to the app) | Public launch |
| gitleaks, staging, deploy/rollback rehearsal, droplet checklist | Still the release gate; not repeated as L batches |

---

## What this plan does not do

- It does not change application code.
- It does not flip `audit/release-gate.md` to GO.
- It does not redo B01–B06 security work.
- It does not set prices, write legal text, or claim production mail, backups, or monitoring are live.
