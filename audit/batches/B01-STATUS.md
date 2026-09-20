# B01 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch.

Verification: `audit/verification/B01.md` (Prompt V against `d721603`). App code was not changed by the verifier.

| ID | Status |
|---|---|
| A2-01 | **Verified** — last SENT `UPLOAD_REQUEST` only; no global `findMany`. Residual: CC/`additionalEmails` From skipped unless that address is `recipientEmail`. |
| A2-02 | **Verified** — Svix always checked when secret set; prod boot + 503 if missing. Residual: skippable when `NODE_ENV` is not exactly `production`. |
| A2-03 | **Verified** — map or slug-equals gate; default flag off. Residual: `updateVendor`/`listVendors`/`mirrorDeleteToCore` still use `CORE_ORG_SLUG` without a vendor. |
| A2-08 | **Verified** — `meta.emailId` or single-org SENT; two-org skip. Residual: cron/v1/chase still omit `emailId`. |
| A4-01 | **Verified** — https + `*.resend.com`, no fetch on reject, 5s + `redirect: 'error'`. |
| A4-02 | **Verified** — http/private rejected at API+CLI write; http + IPv4 private blocked at dispatch. Residual: bracketed IPv6 literals pass `parseHttpsUrl` if already in DB; no send-time DNS. |
| A5-01 / A1-05 | **Verified** — boot schema; process exits without JWT / prod webhook secret. Residual: `NODE_ENV` aliases. |
| A6-02 | **Verified** — shared 5s `fetchWithTimeout` on Core + inbound download. |

**Prompt V recommendation: merge PR #10.**

Backlog (`audit/backlog.md`) is only on PR #9; not copied onto this branch. Update those rows to the statuses above when #9 lands.
