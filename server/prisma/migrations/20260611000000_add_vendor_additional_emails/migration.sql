-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "additionalEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
