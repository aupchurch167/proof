#!/usr/bin/env node

/**
 * One-time import of COI records from Airtable into Proof.
 *
 * For each Airtable COI row:
 *   - looks up the Proof vendor via Vendor.airtableRecordId
 *     (so the Airtable Vendor link maps cleanly across)
 *   - downloads the COI attachment from Airtable
 *   - uploads it to DO Spaces / R2 under cois/
 *   - runs AI extraction on PDFs (skips for images — falls back to
 *     Airtable's structured GL #, WC #, expiration date fields)
 *   - runs compliance check against org settings (if any)
 *   - creates a Coi row with status: APPROVED (already vetted in Airtable)
 *   - bumps the vendor's coiStatus via updateVendorStatus()
 *
 * Idempotent on Coi.airtableRecordId: re-runs skip existing COIs instead of
 * re-extracting, which keeps Anthropic API costs and rate limits in check.
 * To force re-processing of a row, delete the Coi from Proof first.
 *
 * Usage:
 *   node scripts/import-airtable-cois.js [--dry-run] [--no-ai] [--limit=N]
 *
 *   --dry-run   Resolve vendors and list what would happen. No writes, no
 *               uploads, no AI calls.
 *   --no-ai     Skip the Claude extraction step even for PDFs. Always use
 *               Airtable's structured fields. Useful for fast / free runs.
 *   --limit=N   Process only the first N COI rows. Useful for piloting cost.
 *
 * Required env (in server/.env):
 *   AIRTABLE_API_KEY    PAT (data.records:read + schema.bases:read)
 *   AIRTABLE_BASE_ID    e.g. appNC1gMzTS52wpTS
 *   PROOF_ORG_ID        Proof Organization uuid
 *   ANTHROPIC_API_KEY   (only required without --no-ai)
 *   DO_SPACES_* + DATABASE_URL  (same as the server)
 *
 * Cost note: each AI extraction is one Anthropic API call against a PDF.
 * For Claude Sonnet 4 that's roughly a couple cents per multi-page COI;
 * 150 COIs would land in the $5-20 ballpark. Pilot with --limit=5 first.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { uploadFile } = require('../src/services/storage');
const { checkCompliance, updateVendorStatus } = require('../src/services/compliance');

const COI_TABLE = 'COI';

const FIELD_MAP = {
  vendor:        'Vendor',           // multipleRecordLinks → array of Airtable Vendor record ids
  attachment:    'COI',              // multipleAttachments
  glPolicy:      'GL #',
  wcPolicy:      'WC #',
  glExpiration:  'GL Expiration',
  wcExpiration:  'WC Expiration',
  contactEmail:  'Contact Email',
};

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');
const noAi   = process.argv.includes('--no-ai');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function fetchAirtableCois() {
  const baseId = required('AIRTABLE_BASE_ID');
  const apiKey = required('AIRTABLE_API_KEY');
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(COI_TABLE)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

async function downloadAttachment(att) {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`Download ${att.filename} failed: ${res.status}`);
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    mimetype: att.type || 'application/octet-stream',
    filename: att.filename,
  };
}

function pickFirst(value) {
  if (Array.isArray(value) && value.length > 0) return value[0];
  return null;
}

function ext(filename) {
  return path.extname(filename || '') || '.pdf';
}

// Airtable returns dollar amounts on COIs — but in this base GL/WC amounts
// aren't structured fields, only policy numbers + expiration dates. Coverage
// amounts come from AI extraction (or stay null without --no-ai).
function buildExtractedFromAirtable(fields) {
  const gl = fields[FIELD_MAP.glExpiration]?.trim?.() || null;
  const wc = fields[FIELD_MAP.wcExpiration]?.trim?.() || null;
  return {
    glPolicyNumber:   fields[FIELD_MAP.glPolicy]?.trim?.() || null,
    wcPolicyNumber:   fields[FIELD_MAP.wcPolicy]?.trim?.() || null,
    glExpirationDate: gl,
    wcExpirationDate: wc,
  };
}

function isPdf(att) {
  return (att.type || '').toLowerCase() === 'application/pdf';
}

async function tryExtract(buf, mimetype) {
  if (noAi) return null;
  if (mimetype !== 'application/pdf') return null;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  (no ANTHROPIC_API_KEY set; falling back to Airtable fields)');
    return null;
  }
  const { extractCoiData } = require('../src/services/coiExtractor');
  try {
    return await extractCoiData(buf);
  } catch (err) {
    console.warn(`  AI extract failed (${err.message}); falling back to Airtable fields`);
    return null;
  }
}

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function importOne(record, orgId, orgSettings, orgName) {
  const f = record.fields;
  const vendorAirtableId = pickFirst(f[FIELD_MAP.vendor]);
  if (!vendorAirtableId) return { status: 'skipped', reason: 'no linked vendor' };

  const vendor = await prisma.vendor.findFirst({
    where: { orgId, airtableRecordId: vendorAirtableId, deletedAt: null },
  });
  if (!vendor) return { status: 'skipped', reason: `no Proof vendor for Airtable id ${vendorAirtableId}` };

  const att = pickFirst(f[FIELD_MAP.attachment]);
  if (!att) return { status: 'skipped', reason: `no attachment (${vendor.name})` };

  const existing = await prisma.coi.findUnique({ where: { airtableRecordId: record.id } });
  if (existing) return { status: 'skipped', reason: `already imported (${vendor.name})` };

  if (dryRun) {
    return {
      status: 'dry',
      vendor: vendor.name,
      file: att.filename,
      willExtract: !noAi && isPdf(att),
    };
  }

  const { buf, mimetype, filename } = await downloadAttachment(att);

  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext(filename)}`;
  const pdfPath = await uploadFile(buf, key, mimetype, 'cois');

  let extracted = await tryExtract(buf, mimetype);
  const fallback = buildExtractedFromAirtable(f);
  // Always fold in Airtable's structured fields where AI didn't produce one.
  extracted = { ...fallback, ...(extracted || {}) };

  const coiData = {
    vendorId: vendor.id,
    orgId,
    pdfPath,
    status: 'APPROVED',
    aiExtractedData: extracted,
    submittedAt: new Date(record.createdTime || Date.now()),
    airtableRecordId: record.id,
    glPolicyNumber:   extracted.glPolicyNumber || null,
    glCoverageAmount: extracted.glCoverageAmount || null,
    glExpirationDate: toDate(extracted.glExpirationDate),
    wcPolicyNumber:   extracted.wcPolicyNumber || null,
    wcCoverageAmount: extracted.wcCoverageAmount || null,
    wcExpirationDate: toDate(extracted.wcExpirationDate),
    umbPolicyNumber:   extracted.umbPolicyNumber || null,
    umbCoverageAmount: extracted.umbCoverageAmount || null,
    umbExpirationDate: toDate(extracted.umbExpirationDate),
    autoPolicyNumber:   extracted.autoPolicyNumber || null,
    autoCoverageAmount: extracted.autoCoverageAmount || null,
    autoExpirationDate: toDate(extracted.autoExpirationDate),
    coverageType:    extracted.coverageType || null,
    agentName:       extracted.agentName || null,
    agentEmail:      extracted.agentEmail || f[FIELD_MAP.contactEmail]?.trim() || null,
    agentPhone:      extracted.agentPhone || null,
    insuranceCompany: extracted.insuranceCompany || null,
    certificateHolderName:    extracted.certificateHolderName || null,
    certificateHolderAddress: extracted.certificateHolderAddress || null,
  };

  if (orgSettings && extracted) {
    const flags = checkCompliance(extracted, orgSettings, orgName);
    if (flags.length > 0) coiData.complianceFlags = flags;
  }

  const created = await prisma.coi.create({ data: coiData });
  await updateVendorStatus(prisma, vendor.id, orgId);

  return { status: 'created', coiId: created.id, vendor: vendor.name };
}

async function main() {
  const orgId = required('PROOF_ORG_ID');
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { settings: true },
  });
  if (!org) throw new Error(`Organization ${orgId} not found`);
  console.log(`[Airtable COI] Target org: ${org.name} (${org.id})${dryRun ? ' [dry run]' : ''}${noAi ? ' [no-ai]' : ''}`);

  let records = await fetchAirtableCois();
  console.log(`[Airtable COI] Fetched ${records.length} record(s)`);
  if (limit) {
    records = records.slice(0, limit);
    console.log(`[Airtable COI] Limited to ${records.length}`);
  }

  let created = 0, skipped = 0, failed = 0;
  for (const r of records) {
    try {
      const result = await importOne(r, orgId, org.settings, org.name);
      if (result.status === 'created') { created++; console.log(`  + ${result.vendor} -> ${result.coiId}`); }
      if (result.status === 'skipped') { skipped++; console.log(`  - skipped: ${result.reason}`); }
      if (result.status === 'dry')     { console.log(`  ? ${result.vendor} | file=${result.file} extract=${result.willExtract ? 'AI' : 'airtable-fields'}`); }
    } catch (err) {
      failed++;
      console.error(`  ! ${r.id}: ${err.message}`);
    }
  }
  console.log(`[Airtable COI] done. created=${created} skipped=${skipped} failed=${failed}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
