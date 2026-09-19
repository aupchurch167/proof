-- AlterTable: the calling system's own id for a vendor, for idempotent creates
-- through the public API. NULLs are not considered equal in a Postgres unique
-- index, so vendors created in the app (no externalId) are unaffected.
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_orgId_externalId_key" ON "Vendor"("orgId", "externalId");

-- AlterTable: COI request fields carried by the public API contract.
ALTER TABLE "CoiRequest" ADD COLUMN IF NOT EXISTS "requestedBy" TEXT;
ALTER TABLE "CoiRequest" ADD COLUMN IF NOT EXISTS "additionalInsured" TEXT;
ALTER TABLE "CoiRequest" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

-- Data migration: grant the new `vendors:write` scope to every existing token
-- that already holds the full set of scopes that existed before this migration.
-- Tokens are minted with the scope list materialized at creation time, so
-- without this an existing "all scopes" token would start 403-ing on create.
-- Deliberately narrow: tokens issued with a hand-picked subset keep that subset.
UPDATE "ApiClient"
SET "scopes" = array_append("scopes", 'vendors:write')
WHERE NOT ('vendors:write' = ANY("scopes"))
  AND 'vendors:read' = ANY("scopes")
  AND 'coi-requests:read' = ANY("scopes")
  AND 'coi-requests:write' = ANY("scopes");
