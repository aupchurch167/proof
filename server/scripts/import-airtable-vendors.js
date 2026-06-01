#!/usr/bin/env node

/**
 * One-time import of vendors from Airtable into Proof.
 *
 * For each Airtable row this script:
 *   - downloads the W9 + Master Agreement attachments
 *   - uploads them to DO Spaces under w9s/ and master-agreements/
 *   - upserts a Vendor in the target org (matched by email)
 *
 * Idempotent on (orgId, email): re-running updates existing vendors instead
 * of duplicating. Attachments are re-uploaded on every run (cheap; gives the
 * Airtable side authoritative control over file contents).
 *
 * Does NOT mirror to Helm Core. This is for a personal org separate from MAC.
 *
 * Usage:
 *   node scripts/import-airtable-vendors.js [--dry-run]
 *
 * Required env (in server/.env):
 *   AIRTABLE_API_KEY        Personal Access Token from
 *                           https://airtable.com/create/tokens
 *                           with data.records:read + schema.bases:read scopes
 *   AIRTABLE_BASE_ID        e.g. appXXXXXXXXXXXXXX
 *   AIRTABLE_TABLE_NAME     name or id of the vendor table
 *   PROOF_ORG_ID            uuid of the Proof Organization to import into
 *   DO_SPACES_* + DATABASE_URL (same as the server)
 *
 * Edit FIELD_MAP below so the Airtable column names on the right match yours.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { uploadFile } = require('../src/services/storage');

// === Edit if your Airtable column names differ from MAC's base =============
const FIELD_MAP = {
  name:            'Name',
  contactName:     'Contact',
  email:           'Email',
  phone:           'Number',
  // Address is composed from these four columns (any missing parts are skipped).
  addressParts:    ['Address', 'City', 'State', 'Zip'],
  trade:           'Trade',
  notes:           'Notes',
  w9:              'W9',
  masterAgreement: 'Master Agreement',
};
// ===========================================================================

function composeAddress(fields) {
  const street = fields[FIELD_MAP.addressParts[0]]?.trim();
  const city   = fields[FIELD_MAP.addressParts[1]]?.trim();
  const state  = fields[FIELD_MAP.addressParts[2]]?.trim();
  const zip    = fields[FIELD_MAP.addressParts[3]]?.trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, cityStateZip].filter(Boolean).join(', ') || null;
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'vendor';
}

// Proof requires an email on every Vendor. For Airtable rows with no email,
// synthesize one from the name + Airtable record id so the row still imports
// and the user can fix it later in Proof's UI.
function synthesizeEmail(name, recordId) {
  return `${slugify(name)}-${recordId}@no-email.proofcoi.local`;
}

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

async function fetchAirtableRecords() {
  const baseId = required('AIRTABLE_BASE_ID');
  const tableName = required('AIRTABLE_TABLE_NAME');
  const apiKey = required('AIRTABLE_API_KEY');
  const records = [];
  let offset;

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable ${res.status}: ${body}`);
    }
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

async function downloadAttachment(att) {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`Download ${att.filename} failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, mimetype: att.type || 'application/octet-stream', filename: att.filename };
}

function pickFirst(value) {
  if (Array.isArray(value) && value.length > 0) return value[0];
  return null;
}

function ext(filename) {
  const e = path.extname(filename || '');
  return e || '.pdf';
}

async function uploadAttachment(att, prefix) {
  const { buf, mimetype, filename } = await downloadAttachment(att);
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext(filename)}`;
  return uploadFile(buf, key, mimetype, prefix);
}

async function importOne(record, orgId) {
  const f = record.fields;
  const name = f[FIELD_MAP.name]?.trim();
  const rawEmail = f[FIELD_MAP.email]?.trim();

  if (!name) {
    return { status: 'skipped', reason: 'missing name' };
  }

  const email = rawEmail || synthesizeEmail(name, record.id);
  const syntheticEmail = !rawEmail;

  const baseData = {
    name,
    contactName: f[FIELD_MAP.contactName]?.trim() || null,
    email,
    phone:   f[FIELD_MAP.phone]?.trim()   || null,
    address: composeAddress(f),
    trade:   f[FIELD_MAP.trade]?.trim()   || null,
    notes:   f[FIELD_MAP.notes]?.trim()   || null,
  };

  const w9Att = pickFirst(f[FIELD_MAP.w9]);
  const maAtt = pickFirst(f[FIELD_MAP.masterAgreement]);

  if (dryRun) {
    return {
      status: 'dry',
      data: baseData,
      syntheticEmail,
      w9: w9Att ? w9Att.filename : null,
      masterAgreement: maAtt ? maAtt.filename : null,
    };
  }

  const data = { ...baseData };
  if (w9Att) data.w9Path = await uploadAttachment(w9Att, 'w9s');
  if (maAtt) data.masterAgreementPath = await uploadAttachment(maAtt, 'master-agreements');

  data.airtableRecordId = record.id;

  const existing = await prisma.vendor.findFirst({
    where: {
      orgId,
      deletedAt: null,
      OR: [{ airtableRecordId: record.id }, { email }],
    },
  });

  if (existing) {
    await prisma.vendor.update({ where: { id: existing.id }, data });
    return { status: 'updated', vendorId: existing.id };
  }

  const created = await prisma.vendor.create({ data: { ...data, orgId } });
  return { status: 'created', vendorId: created.id };
}

async function main() {
  const orgId = required('PROOF_ORG_ID');

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error(`Organization ${orgId} not found`);
  console.log(`[Airtable] Target org: ${org.name} (${org.id})${dryRun ? ' [dry run]' : ''}`);

  const records = await fetchAirtableRecords();
  console.log(`[Airtable] Fetched ${records.length} record(s)`);

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const r of records) {
    try {
      const result = await importOne(r, orgId);
      if (result.status === 'created')  { created++; console.log(`  + ${r.fields[FIELD_MAP.name]} -> ${result.vendorId}`); }
      if (result.status === 'updated')  { updated++; console.log(`  ~ ${r.fields[FIELD_MAP.name]} -> ${result.vendorId}`); }
      if (result.status === 'skipped')  { skipped++; console.log(`  - skipped: ${result.reason}`); }
      if (result.status === 'dry')      {
        const tag = result.syntheticEmail ? ' [synthetic email]' : '';
        console.log(`  ? ${result.data.name}${tag} | w9=${result.w9 || '-'} ma=${result.masterAgreement || '-'}`);
      }
    } catch (err) {
      failed++;
      console.error(`  ! ${r.fields[FIELD_MAP.name] || r.id}: ${err.message}`);
    }
  }

  console.log(`[Airtable] done. created=${created} updated=${updated} skipped=${skipped} failed=${failed}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
