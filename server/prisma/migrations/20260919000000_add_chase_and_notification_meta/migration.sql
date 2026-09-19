-- AlterEnum
-- Guarded so the migration is safe against databases that already picked these
-- up via `prisma db push`.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'UPLOAD_CHASE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MANUAL_CONTACT';

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN IF NOT EXISTS "chaseDaysAfterRequest" JSONB NOT NULL DEFAULT '[3, 7, 14]';
ALTER TABLE "OrganizationSettings" ADD COLUMN IF NOT EXISTS "chaseNonResponders" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "meta" JSONB;
