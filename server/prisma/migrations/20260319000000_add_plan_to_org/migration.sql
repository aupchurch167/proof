-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'UNLIMITED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "plan" "Plan" NOT NULL DEFAULT 'FREE';
