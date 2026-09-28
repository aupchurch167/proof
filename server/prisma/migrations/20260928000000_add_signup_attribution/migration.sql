-- Signup attribution. Additive nullable columns; existing organizations stay null.
-- Organization.createdAt (already present) is the signup timestamp.

ALTER TABLE "Organization" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "Organization" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "Organization" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "Organization" ADD COLUMN "utmTerm" TEXT;
ALTER TABLE "Organization" ADD COLUMN "utmContent" TEXT;

CREATE INDEX "Organization_utmSource_createdAt_idx" ON "Organization"("utmSource", "createdAt");
