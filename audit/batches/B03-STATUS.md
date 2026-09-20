# B03 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not on `main` when this batch landed. Finding text used as source of truth from that branch.

| ID | Status |
|---|---|
| A3-02 | **Fixed — pending verification** — Vendor single + bulk delete soft-delete COIs in a transaction with the vendor. `deleteFile` is not called. NotificationLog rows stay. ADMIN `GET /api/cois/:id?includeDeleted=true` still returns the row. Residual: individual `DELETE /api/cois/:id` still hard-deletes + `deleteFile`. |
| A3-03 | **Partial — AuditLog Restrict only** — `AuditLog.orgId` is now `onDelete: Restrict`. Other Organization children stay Cascade. Full offboarding / Restrict rewrite is a follow-up (see `audit/findings/new.md`). |
| A3-04 | **Fixed — pending verification** — Each cron sweep takes a Postgres advisory lock (`pg_try_advisory_lock`) on a dedicated `pg` connection. Overlap no-ops. Residual: still in-process; no boot catch-up; no external scheduler. |
| A3-07 | **Fixed — pending verification** — Import create calls `generateUploadToken(vendor.id)`. Vendor+COI delete is transactional (no Spaces delete). Residual: import vendor writes are still per-row, not one CSV transaction. |
| A3-10 | **Fixed — pending verification** — `enforcePlanLimit` catch returns **503** `PLAN_LIMIT_UNAVAILABLE` (does not `next()`). |
| A2-12 | **Fixed — pending verification** — Partial unique index `Vendor_orgId_email_active_key` on `(orgId, email) WHERE deletedAt IS NULL`. Migration soft-deletes surplus live duplicates (keeps oldest). Create/update/apply surface **409**. Residual: not `lower(email)` — case variants can still coexist. |
| A6-04 | **Fixed — pending verification** — `start*Cron` return job handles; `startCronJobs` / `stopCronJobs`; SIGTERM/SIGINT call `job.stop()` before `server.close`. Residual: shutdown does not wait for an in-flight sweep to finish (10s force-exit remains). |

**Prompt F: Fixed — pending verification.** Do not merge until Prompt V.
