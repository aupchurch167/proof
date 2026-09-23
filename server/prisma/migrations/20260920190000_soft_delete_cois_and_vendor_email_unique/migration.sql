-- B03 (A3-02, A2-12, A3-03): retain COIs on vendor delete, unique live emails,
-- and stop cascading Organization deletes into AuditLog.

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_orgId_fkey";

-- AlterTable
ALTER TABLE "Coi" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Coi_orgId_deletedAt_idx" ON "Coi"("orgId", "deletedAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soft-delete surplus live vendors that share (orgId, email), keeping the oldest.
-- Idempotent: a second run finds no rn > 1 rows.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "orgId", email ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Vendor"
  WHERE "deletedAt" IS NULL
)
UPDATE "Vendor" AS v
SET "deletedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE v.id = ranked.id
  AND ranked.rn > 1;

-- Prisma cannot express a partial unique index in schema.prisma.
CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_orgId_email_active_key"
ON "Vendor" ("orgId", email)
WHERE "deletedAt" IS NULL;
