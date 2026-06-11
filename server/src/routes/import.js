const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { parseCsv, generateCsv, VENDOR_HEADERS, COI_HEADERS } = require('../utils/csv');
const { checkCompliance } = require('../services/compliance');
const { getPlanLimits, getPlanLabel } = require('../config/plans');
const core = require('../lib/core');
const { mapTradeToCanonical } = require('../constants/trades');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/import/template/vendors — download vendor CSV template (no auth — static sample data)
router.get('/template/vendors', (req, res) => {
  const sample = [{
    name: 'Acme Plumbing LLC',
    contact_name: 'John Doe',
    email: 'billing@acmeplumbing.com',
    phone: '555-0101',
    address: '456 Oak St, Austin, TX 78702',
    trade: 'Plumbing',
  }];
  const csv = generateCsv(VENDOR_HEADERS, sample);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=vendor-import-template.csv');
  res.send(csv);
});

// GET /api/import/template/cois — download COI CSV template (no auth — static sample data)
router.get('/template/cois', (req, res) => {
  const sample = [{
    vendor_email: 'billing@acmeplumbing.com',
    gl_policy_number: 'GL-12345',
    gl_coverage_amount: '1000000',
    gl_expiration_date: '2026-12-31',
    wc_policy_number: 'WC-12345',
    wc_coverage_amount: '500000',
    wc_expiration_date: '2026-12-31',
    umb_policy_number: 'UMB-12345',
    umb_coverage_amount: '1000000',
    umb_expiration_date: '2026-12-31',
    auto_policy_number: 'AUTO-12345',
    auto_coverage_amount: '1000000',
    auto_expiration_date: '2026-12-31',
    agent_name: 'Jane Smith',
    agent_email: 'jane@insurance.com',
    agent_phone: '555-0200',
    insurance_company: 'State Farm',
  }];
  const csv = generateCsv(COI_HEADERS, sample);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=coi-import-template.csv');
  res.send(csv);
});

// POST /api/import/preview — parse CSV and return headers + preview rows (no import yet)
router.post('/preview', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file required' });
    }

    const text = req.file.buffer.toString('utf-8');
    const { headers, rows } = parseCsv(text);

    if (headers.length === 0) {
      return res.status(400).json({ error: 'File is empty or has no headers' });
    }

    res.json({
      headers,
      rowCount: rows.length,
      preview: rows.slice(0, 5),
    });
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'Failed to parse CSV' });
  }
});

// POST /api/import/vendors — bulk import vendors
// Expects JSON body: { headerMap: { templateField: csvHeader }, csvData: string }
router.post('/vendors', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file required' });
    }

    const headerMap = JSON.parse(req.body.headerMap || '{}');
    const text = req.file.buffer.toString('utf-8');
    const { rows } = parseCsv(text);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data rows found' });
    }

    // Validate that required mapped headers exist
    if (!headerMap.name || !headerMap.email) {
      return res.status(400).json({ error: 'Name and email header mappings are required' });
    }

    // Check plan limits
    const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { plan: true } });
    const limits = getPlanLimits(org?.plan || 'FREE');
    const label = getPlanLabel(org?.plan || 'FREE');
    let vendorCount = limits.maxVendors !== Infinity
      ? await prisma.vendor.count({ where: { orgId: req.user.orgId, deletedAt: null } })
      : 0;

    const results = { created: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row[headerMap.name]?.trim();
      const contactName = headerMap.contact_name ? row[headerMap.contact_name]?.trim() : null;
      const email = row[headerMap.email]?.trim();
      const phone = headerMap.phone ? row[headerMap.phone]?.trim() : null;
      const address = headerMap.address ? row[headerMap.address]?.trim() : null;
      const rawTrade = headerMap.trade ? row[headerMap.trade]?.trim() : null;
      const trade = rawTrade ? mapTradeToCanonical(rawTrade) : null;

      if (!name || !email) {
        results.errors.push({ row: i + 2, message: 'Missing name or email' });
        results.skipped++;
        continue;
      }

      // Check for existing vendor by email within this org
      const existing = await prisma.vendor.findFirst({
        where: { orgId: req.user.orgId, email, deletedAt: null },
      });

      if (existing) {
        results.errors.push({ row: i + 2, message: `Vendor with email ${email} already exists` });
        results.skipped++;
        continue;
      }

      // Check vendor plan limit
      if (limits.maxVendors !== Infinity && vendorCount >= limits.maxVendors) {
        results.errors.push({ row: i + 2, message: `Vendor limit (${limits.maxVendors}) reached for ${label} plan` });
        results.skipped++;
        continue;
      }

      try {
        const created = await prisma.vendor.create({
          data: {
            orgId: req.user.orgId,
            name,
            contactName: contactName || null,
            email,
            phone: phone || null,
            address: address || null,
            trade: trade || null,
          },
        });
        vendorCount++;
        results.created++;
        mirrorImportedVendorToCore(created);
      } catch (err) {
        results.errors.push({ row: i + 2, message: err.message });
        results.skipped++;
      }
    }

    res.json(results);
  } catch (err) {
    console.error('Vendor import error:', err);
    res.status(500).json({ error: 'Failed to import vendors' });
  }
});

async function mirrorImportedVendorToCore(vendor) {
  if (!core.isEnabled()) return;
  try {
    const result = await core.createVendor(vendor);
    const coreId = result && result.data && result.data.id;
    if (coreId) {
      await prisma.vendor.update({ where: { id: vendor.id }, data: { coreId } });
    } else {
      console.warn('[Core] import: createVendor returned no id; vendor not linked', { vendorId: vendor.id });
    }
  } catch (err) {
    console.error('[Core] import: failed to mirror vendor:', core.formatError(err));
  }
}

// POST /api/import/cois — bulk import COIs
router.post('/cois', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file required' });
    }

    const headerMap = JSON.parse(req.body.headerMap || '{}');
    const runComplianceCheck = req.body.runComplianceCheck === 'true';
    const text = req.file.buffer.toString('utf-8');
    const { rows } = parseCsv(text);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data rows found' });
    }

    if (!headerMap.vendor_email) {
      return res.status(400).json({ error: 'Vendor email header mapping is required' });
    }

    // Check plan limits
    const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { plan: true } });
    const coiLimits = getPlanLimits(org?.plan || 'FREE');
    const coiLabel = getPlanLabel(org?.plan || 'FREE');
    let coiCount = coiLimits.maxCois !== Infinity
      ? await prisma.coi.count({ where: { orgId: req.user.orgId } })
      : 0;

    // Load org settings and name if compliance check requested
    let orgSettings = null;
    let orgName = null;
    if (runComplianceCheck) {
      const orgData = await prisma.organization.findUnique({
        where: { id: req.user.orgId },
        select: { name: true, settings: true },
      });
      orgSettings = orgData?.settings;
      orgName = orgData?.name;
    }

    const results = { created: 0, skipped: 0, errors: [], flagged: 0 };

    // Helper to parse dollar amount to cents
    const toCents = (val) => {
      if (!val) return null;
      const num = parseFloat(val.replace(/[$,]/g, ''));
      return isNaN(num) ? null : Math.round(num * 100);
    };

    const toDate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    const getVal = (row, field) => {
      return headerMap[field] ? row[headerMap[field]]?.trim() || null : null;
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const vendorEmail = row[headerMap.vendor_email]?.trim();

      if (!vendorEmail) {
        results.errors.push({ row: i + 2, message: 'Missing vendor email' });
        results.skipped++;
        continue;
      }

      // Look up vendor by email within org
      const vendor = await prisma.vendor.findFirst({
        where: { orgId: req.user.orgId, email: vendorEmail, deletedAt: null },
      });

      if (!vendor) {
        results.errors.push({ row: i + 2, message: `No vendor found with email ${vendorEmail}` });
        results.skipped++;
        continue;
      }

      // Check COI plan limit
      if (coiLimits.maxCois !== Infinity && coiCount >= coiLimits.maxCois) {
        results.errors.push({ row: i + 2, message: `COI limit (${coiLimits.maxCois}) reached for ${coiLabel} plan` });
        results.skipped++;
        continue;
      }

      try {
        const coiData = {
          vendorId: vendor.id,
          orgId: req.user.orgId,
          pdfPath: '',
          status: 'PENDING_REVIEW',

          glPolicyNumber: getVal(row, 'gl_policy_number'),
          glCoverageAmount: toCents(getVal(row, 'gl_coverage_amount')),
          glExpirationDate: toDate(getVal(row, 'gl_expiration_date')),

          wcPolicyNumber: getVal(row, 'wc_policy_number'),
          wcCoverageAmount: toCents(getVal(row, 'wc_coverage_amount')),
          wcExpirationDate: toDate(getVal(row, 'wc_expiration_date')),

          umbPolicyNumber: getVal(row, 'umb_policy_number'),
          umbCoverageAmount: toCents(getVal(row, 'umb_coverage_amount')),
          umbExpirationDate: toDate(getVal(row, 'umb_expiration_date')),

          autoPolicyNumber: getVal(row, 'auto_policy_number'),
          autoCoverageAmount: toCents(getVal(row, 'auto_coverage_amount')),
          autoExpirationDate: toDate(getVal(row, 'auto_expiration_date')),

          agentName: getVal(row, 'agent_name'),
          agentEmail: getVal(row, 'agent_email'),
          agentPhone: getVal(row, 'agent_phone'),
          insuranceCompany: getVal(row, 'insurance_company'),
        };

        // Run compliance check if enabled
        if (runComplianceCheck && orgSettings) {
          const extractedForCheck = {
            glCoverageAmount: coiData.glCoverageAmount,
            wcCoverageAmount: coiData.wcCoverageAmount,
            umbCoverageAmount: coiData.umbCoverageAmount,
            autoCoverageAmount: coiData.autoCoverageAmount,
            glExpirationDate: coiData.glExpirationDate?.toISOString?.() || getVal(row, 'gl_expiration_date'),
            wcExpirationDate: coiData.wcExpirationDate?.toISOString?.() || getVal(row, 'wc_expiration_date'),
            umbExpirationDate: coiData.umbExpirationDate?.toISOString?.() || getVal(row, 'umb_expiration_date'),
            autoExpirationDate: coiData.autoExpirationDate?.toISOString?.() || getVal(row, 'auto_expiration_date'),
          };

          const flags = checkCompliance(extractedForCheck, orgSettings, orgName);
          if (flags.length > 0) {
            coiData.complianceFlags = flags;
            results.flagged++;
          }
        }

        await prisma.coi.create({ data: coiData });
        coiCount++;

        // Update vendor status to pending
        await prisma.vendor.update({
          where: { id: vendor.id },
          data: { coiStatus: 'PENDING' },
        });

        results.created++;
      } catch (err) {
        results.errors.push({ row: i + 2, message: err.message });
        results.skipped++;
      }
    }

    res.json(results);
  } catch (err) {
    console.error('COI import error:', err);
    res.status(500).json({ error: 'Failed to import COIs' });
  }
});

module.exports = router;
