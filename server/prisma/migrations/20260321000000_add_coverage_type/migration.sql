-- CreateEnum
CREATE TYPE "CoverageType" AS ENUM ('GENERAL_LIABILITY', 'WORKERS_COMP', 'UMBRELLA', 'AUTO', 'OTHER');

-- AlterTable
ALTER TABLE "Coi" ADD COLUMN "coverageType" "CoverageType";
