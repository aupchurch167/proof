-- B02 (A1-01, A1-04): persist refresh sessions and hash invite tokens.
-- Additive only. inviteToken is kept for rollback / un-backfilled rows.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "inviteTokenExpiry" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_family_idx" ON "Session"("family");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotent backfill: hash existing plaintext invites and expire them 48h
-- after the user row was created (pending invites older than that stop working).
UPDATE "User"
SET
  "inviteTokenHash" = encode(sha256(convert_to("inviteToken", 'UTF8')), 'hex'),
  "inviteTokenExpiry" = "createdAt" + INTERVAL '48 hours'
WHERE "inviteToken" IS NOT NULL
  AND "inviteTokenHash" IS NULL;
