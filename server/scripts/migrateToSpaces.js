#!/usr/bin/env node

/**
 * One-time migration script: uploads existing local PDF files to DigitalOcean Spaces
 * and updates the database records with the new Spaces key.
 *
 * Usage:
 *   node scripts/migrateToSpaces.js
 *
 * Prerequisites:
 *   - Set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, DO_SPACES_BUCKET,
 *     DO_SPACES_REGION in your .env file
 *   - Ensure the local uploads/ directory still has the PDF files
 *
 * This script is idempotent — it skips COIs whose pdfPath already starts with "cois/"
 * (indicating they've already been migrated).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { uploadFile } = require('../src/services/storage');

const prisma = new PrismaClient();
const uploadsDir = path.join(__dirname, '../uploads');

async function migrate() {
  console.log('[Migration] Starting PDF migration to DigitalOcean Spaces...');
  console.log(`[Migration] Uploads directory: ${uploadsDir}`);
  console.log(`[Migration] Target bucket: ${process.env.DO_SPACES_BUCKET}`);
  console.log('');

  // Validate Spaces configuration
  if (!process.env.DO_SPACES_KEY || !process.env.DO_SPACES_SECRET || !process.env.DO_SPACES_ENDPOINT) {
    console.error('[Migration] ERROR: DigitalOcean Spaces credentials not configured in .env');
    console.error('[Migration] Required: DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, DO_SPACES_BUCKET');
    process.exit(1);
  }

  const cois = await prisma.coi.findMany({
    where: {
      pdfPath: { not: null },
    },
    select: {
      id: true,
      pdfPath: true,
      vendor: { select: { name: true } },
    },
  });

  console.log(`[Migration] Found ${cois.length} COI record(s) with PDF paths`);
  console.log('');

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let alreadyMigrated = 0;

  for (let i = 0; i < cois.length; i++) {
    const coi = cois[i];
    const progress = `[${i + 1}/${cois.length}]`;

    // Skip already-migrated records (pdfPath starts with "cois/")
    if (coi.pdfPath.startsWith('cois/')) {
      alreadyMigrated++;
      console.log(`${progress} SKIP (already migrated): ${coi.pdfPath}`);
      continue;
    }

    const localPath = path.join(uploadsDir, coi.pdfPath);

    // Check if local file exists
    if (!fs.existsSync(localPath)) {
      failed++;
      console.log(`${progress} MISSING: ${coi.pdfPath} — local file not found (vendor: ${coi.vendor?.name || 'unknown'})`);
      continue;
    }

    try {
      // Read local file
      const buffer = fs.readFileSync(localPath);

      // Upload to Spaces
      const spacesKey = await uploadFile(buffer, coi.pdfPath, 'application/pdf');

      // Update database record with new Spaces key
      await prisma.coi.update({
        where: { id: coi.id },
        data: { pdfPath: spacesKey },
      });

      migrated++;
      console.log(`${progress} OK: ${coi.pdfPath} → ${spacesKey} (vendor: ${coi.vendor?.name || 'unknown'})`);
    } catch (err) {
      failed++;
      console.error(`${progress} FAIL: ${coi.pdfPath} — ${err.message}`);
    }
  }

  console.log('');
  console.log('[Migration] ========== Summary ==========');
  console.log(`[Migration] Total COI records:   ${cois.length}`);
  console.log(`[Migration] Migrated:            ${migrated}`);
  console.log(`[Migration] Already migrated:     ${alreadyMigrated}`);
  console.log(`[Migration] Skipped (no file):    ${failed}`);
  console.log(`[Migration] Failed:              ${failed}`);
  console.log('[Migration] ============================');

  if (migrated > 0) {
    console.log('');
    console.log('[Migration] Local files in uploads/ can be removed once you verify everything works.');
    console.log('[Migration] The /uploads static route has been removed from the server.');
  }
}

migrate()
  .catch((err) => {
    console.error('[Migration] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
