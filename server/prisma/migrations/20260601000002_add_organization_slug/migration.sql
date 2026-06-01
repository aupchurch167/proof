-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "slug" TEXT;

-- Backfill existing orgs with a slug derived from name (collapse runs of
-- non-alphanumeric into single dash, lowercase, trim). Slug is nullable so
-- collisions are tolerated; admin can rename later.
UPDATE "Organization"
SET "slug" = trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
WHERE "slug" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
