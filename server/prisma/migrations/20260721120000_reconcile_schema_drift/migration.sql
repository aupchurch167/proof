-- Reconcile schema drift.
--
-- These columns, indexes, and enum values exist in schema.prisma (and in any
-- database created/updated with `prisma db push`) but were never captured in a
-- migration, so `prisma migrate deploy` against a fresh database produced a
-- schema that didn't match Prisma Client and could fail.
--
-- Every statement is written idempotently (IF NOT EXISTS) so this migration is
-- safe to apply in both situations:
--   * a fresh CI/local database where these objects do NOT yet exist, and
--   * an existing database (e.g. production) that already has them from db push.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEEKLY_SUMMARY';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEMBER';

-- AlterTable
ALTER TABLE "Coi" ADD COLUMN IF NOT EXISTS "certificateHolderName" TEXT;
ALTER TABLE "Coi" ADD COLUMN IF NOT EXISTS "certificateHolderAddress" TEXT;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Coi_orgId_status_idx" ON "Coi"("orgId", "status");
CREATE INDEX IF NOT EXISTS "Coi_vendorId_status_idx" ON "Coi"("vendorId", "status");
CREATE INDEX IF NOT EXISTS "Coi_orgId_submittedAt_idx" ON "Coi"("orgId", "submittedAt");
CREATE INDEX IF NOT EXISTS "NotificationLog_orgId_idx" ON "NotificationLog"("orgId");
CREATE INDEX IF NOT EXISTS "NotificationLog_vendorId_type_sentAt_idx" ON "NotificationLog"("vendorId", "type", "sentAt");
CREATE UNIQUE INDEX IF NOT EXISTS "User_inviteToken_key" ON "User"("inviteToken");
CREATE UNIQUE INDEX IF NOT EXISTS "User_resetToken_key" ON "User"("resetToken");
CREATE INDEX IF NOT EXISTS "User_orgId_idx" ON "User"("orgId");
CREATE INDEX IF NOT EXISTS "Vendor_orgId_deletedAt_idx" ON "Vendor"("orgId", "deletedAt");
