#!/usr/bin/env node

/**
 * Migrate existing vendor trade values to the canonical trade taxonomy.
 *
 * - Obvious matches are mapped automatically.
 * - Ambiguous values are flagged for manual review.
 *
 * Usage:
 *   node scripts/migrate-vendor-trades.js [--dry-run] [--apply]
 *
 * With --dry-run (default): prints what would change without writing.
 * With --apply: writes the mapped trades to the database.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const { mapTradeToCanonical, CANONICAL_TRADES_SET } = require('../src/constants/trades');

const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');

async function main() {
  const vendors = await prisma.vendor.findMany({
    where: { trade: { not: null }, deletedAt: null },
    select: { id: true, name: true, trade: true },
  });

  console.log(`Found ${vendors.length} vendor(s) with a trade value\n`);

  const mapped = [];
  const alreadyCanonical = [];
  const ambiguous = [];

  for (const v of vendors) {
    if (CANONICAL_TRADES_SET.has(v.trade)) {
      alreadyCanonical.push(v);
      continue;
    }

    const canonical = mapTradeToCanonical(v.trade);
    if (canonical) {
      mapped.push({ ...v, newTrade: canonical });
    } else {
      ambiguous.push(v);
    }
  }

  if (alreadyCanonical.length > 0) {
    console.log(`Already canonical (${alreadyCanonical.length}):`);
    for (const v of alreadyCanonical) {
      console.log(`  OK  ${v.name} -> "${v.trade}"`);
    }
    console.log();
  }

  if (mapped.length > 0) {
    console.log(`Auto-mapped (${mapped.length}):`);
    for (const v of mapped) {
      console.log(`  MAP ${v.name}: "${v.trade}" -> "${v.newTrade}"`);
    }
    console.log();
  }

  if (ambiguous.length > 0) {
    console.log(`AMBIGUOUS — needs manual review (${ambiguous.length}):`);
    for (const v of ambiguous) {
      console.log(`  ???  ${v.name}: "${v.trade}" (id: ${v.id})`);
    }
    console.log();
  }

  if (applyChanges && mapped.length > 0) {
    console.log('Applying changes...');
    for (const v of mapped) {
      await prisma.vendor.update({
        where: { id: v.id },
        data: { trade: v.newTrade },
      });
      console.log(`  Updated ${v.name}: "${v.trade}" -> "${v.newTrade}"`);
    }
    console.log(`\nDone. ${mapped.length} vendor(s) updated.`);
  } else if (!applyChanges) {
    console.log('Dry run complete. Run with --apply to write changes.');
  }

  console.log(`\nSummary: ${alreadyCanonical.length} canonical, ${mapped.length} mapped, ${ambiguous.length} ambiguous`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
