-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "coreId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_coreId_key" ON "Vendor"("coreId");
