#!/usr/bin/env node

/**
 * Recompute Vendor.coiStatus from the current requirement settings.
 *
 * Run once after deploying the L01 compliance rules. Do not run this on boot.
 *
 * Usage:
 *   node scripts/recompute-vendor-status.js
 *
 * Soft-deleted vendors are left alone. Certificate rows are not deleted or
 * edited — only the cached vendor badge is rewritten.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const { updateVendorStatus } = require('../src/services/compliance');

const prisma = new PrismaClient();

async function main() {
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null },
    select: { id: true, orgId: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Recomputing coiStatus for ${vendors.length} vendor(s).`);

  let updated = 0;
  let failed = 0;
  for (const vendor of vendors) {
    try {
      await updateVendorStatus(prisma, vendor.id, vendor.orgId);
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed ${vendor.name} (${vendor.id}): ${err.message}`);
    }
  }

  console.log(`Done. recomputed=${updated} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
