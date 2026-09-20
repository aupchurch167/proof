# B03 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch.

Verification: `audit/verification/B03.md` (Prompt V against `e9f79e6`). App code was not changed by the verifier.

| ID | Status |
|---|---|
| A3-02 | **Verified** — Vendor single + bulk delete soft-delete COIs in a transaction. `deleteFile` is not called. NotificationLog rows stay. ADMIN `GET /api/cois/:id?includeDeleted=true` (and PDF) still returns the row. Residual: `DELETE /api/cois/:id` still hard-deletes + `deleteFile`; v1 historical + usage COI count still include soft-deleted rows. |
| A3-03 | **Partially fixed — AuditLog Restrict only** — `AuditLog.orgId` is `onDelete: Restrict` (org delete → P2003). Other Organization children stay Cascade. Full offboarding / Restrict rewrite is a follow-up. |
| A3-04 | **Verified** — Each cron sweep takes `pg_try_advisory_lock` on a dedicated `pg` connection. Overlap / other session no-ops. Residual: still in-process; no boot catch-up; pooled (PgBouncer) `DATABASE_URL` can break session locks. |
| A3-07 | **Verified** — Import create calls `generateUploadToken(vendor.id)`; portal GET with that JWT is 200. Residual: import vendor writes are still per-row, not one CSV transaction. |
| A3-10 | **Verified** — `enforcePlanLimit` catch returns **503** `PLAN_LIMIT_UNAVAILABLE` (does not `next()`). Success path 201; FREE cap still 403. Residual: apply calls `evaluatePlanLimit` and 500s on throw. |
| A2-12 | **Verified** — Partial unique index `Vendor_orgId_email_active_key` on `(orgId, email) WHERE deletedAt IS NULL`. Create/update/apply surface **409**. Soft-deleted + new live allowed. Residual: not `lower(email)`; migration backfill does not soft-delete surplus vendors’ COIs. |
| A6-04 | **Verified** — `startCronJobs` / `stopCronJobs`; SIGTERM/SIGINT call `job.stop()` before `server.close` (process exit 0). Residual: shutdown does not wait for an in-flight sweep (10s force-exit remains). |

**Prompt V recommendation: merge PR #15.**

Official `npm test` (this branch, re-run by verifier): **23 suites, 271 tests, passed.**

Backlog (`audit/backlog.md`) is only on PR #9; not copied onto this branch. Update those rows to the statuses above when #9 lands.
