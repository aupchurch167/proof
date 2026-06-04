-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "airtableRecordId" TEXT;
ALTER TABLE "Coi" ADD COLUMN "airtableRecordId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_airtableRecordId_key" ON "Vendor"("airtableRecordId");
CREATE UNIQUE INDEX "Coi_airtableRecordId_key" ON "Coi"("airtableRecordId");
