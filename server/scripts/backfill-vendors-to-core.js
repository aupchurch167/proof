#!/usr/bin/env node

/**
 * Backfill local vendors into Helm Core.
 *
 * Idempotent: vendors with a non-null `coreId` are skipped. After a successful
 * POST, the returned Core id is written back to `Vendor.coreId` so re-running
 * is safe.
 *
 * Usage:
 *   node scripts/backfill-vendors-to-core.js [--dry-run]
 *
 * Required env (in server/.env):
 *   HELM_CORE_INTEGRATION=true
 *   CORE_API_URL=https://helmcore.up.railway.app
 *   CORE_ORG_SLUG=mac
 *   CORE_DEV_USER_ID=<user id from core DB>
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const core = require('../src/lib/core');

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!core.isEnabled()) {
    console.error('HELM_CORE_INTEGRATION is not "true". Aborting.');
    process.exit(1);
  }

  const vendors = await prisma.vendor.findMany({
    where: { coreId: null, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[Backfill] ${vendors.length} vendor(s) to push${dryRun ? ' (dry run)' : ''}`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const vendor of vendors) {
    const payload = core.vendorToCorePayload(vendor);
    if (dryRun) {
      console.log(`[Backfill] DRY ${vendor.id} -> ${JSON.stringify(payload)}`);
      skipped++;
      continue;
    }

    try {
      const result = await core.createVendor(vendor);
      const coreId = result && (result.id || (result.vendor && result.vendor.id));
      if (!coreId) {
        console.warn(`[Backfill] No id returned for vendor ${vendor.id}; not linking`);
        failed++;
        continue;
      }
      await prisma.vendor.update({ where: { id: vendor.id }, data: { coreId } });
      console.log(`[Backfill] OK  ${vendor.id} -> ${coreId}`);
      ok++;
    } catch (err) {
      console.error(`[Backfill] FAIL ${vendor.id}: ${err.status || ''} ${err.message}`, err.body || '');
      failed++;
    }
  }

  console.log(`[Backfill] done. ok=${ok} failed=${failed} skipped=${skipped}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
