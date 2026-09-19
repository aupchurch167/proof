-- AlterTable: requirement-template settings that today apply to the org's one
-- default template.
ALTER TABLE "OrganizationSettings" ADD COLUMN IF NOT EXISTS "requireHolderMatch" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OrganizationSettings" ADD COLUMN IF NOT EXISTS "expiringWindowDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable: the carrier audit window, shared by Requirements and the Audit log.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "coveragePeriod" JSONB;
