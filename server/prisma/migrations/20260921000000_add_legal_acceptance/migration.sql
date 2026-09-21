-- B06 (A10-01): record Terms / Privacy acceptance at signup.
-- Additive only. Existing users stay null until they re-accept (not required here).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "termsVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "privacyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "privacyVersion" TEXT;
