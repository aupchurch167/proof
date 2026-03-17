const express = require('express');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { parseCsv, generateCsv, VENDOR_HEADERS, COI_HEADERS } = require('../utils/csv');

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/import/template/vendors — download vendor CSV template
router.get('/template/vendors', authenticate, (req, res) => {
  const sample = [{
    name: 'Acme Plumbing LLC',
    email: 'billing@acmeplumbing.com',
    phone: '555-0101',
    address: '456 Oak St, Austin, TX 78702',
  }];
  const csv = generateCsv(VENDOR_HEADERS, sample);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=vendor-import-template.csv');
  res.send(csv);
});

// GET /api/import/template/cois — download COI CSV template
router.get('/template/cois', authenticate, (req, res) => {
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
router.post('/preview', authenticate, authorize('ADMIN', 'REVIEWER'), upload.single('file'), (req, res) => {
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
router.post('/vendors', authenticate, authorize('ADMIN', 'REVIEWER'), upload.single('file'), async (req, res) => {
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

    const results = { created: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row[headerMap.name]?.trim();
      const email = row[headerMap.email]?.trim();
      const phone = headerMap.phone ? row[headerMap.phone]?.trim() : null;
      const address = headerMap.address ? row[headerMap.address]?.trim() : null;

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

      try {
        await prisma.vendor.create({
          data: {
            orgId: req.user.orgId,
            name,
            email,
            phone: phone || null,
            address: address || null,
          },
        });
        results.created++;
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

// POST /api/import/cois — bulk import COIs
router.post('/cois', authenticate, authorize('ADMIN', 'REVIEWER'), upload.single('file'), async (req, res) => {
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

    if (!headerMap.vendor_email) {
      return res.status(400).json({ error: 'Vendor email header mapping is required' });
    }

    const results = { created: 0, skipped: 0, errors: [] };

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

      try {
        await prisma.coi.create({
          data: {
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
          },
        });

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
