const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PDFDocument } = require('pdf-lib');
const { authenticate } = require('../middleware/auth');
const { downloadFile } = require('../services/storage');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/compliance
router.get('/compliance', authenticate, async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { orgId: req.user.orgId, deletedAt: null },
    });

    const summary = {
      total: vendors.length,
      compliant: vendors.filter(v => v.coiStatus === 'COMPLIANT').length,
      nonCompliant: vendors.filter(v => v.coiStatus === 'NON_COMPLIANT').length,
      expiringSoon: vendors.filter(v => v.coiStatus === 'EXPIRING_SOON').length,
      expired: vendors.filter(v => v.coiStatus === 'EXPIRED').length,
      pending: vendors.filter(v => v.coiStatus === 'PENDING').length,
      noCoi: vendors.filter(v => v.coiStatus === 'NO_COI').length,
    };

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get compliance summary' });
  }
});

// GET /api/reports/cois — audit report with date range
router.get('/cois', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, status, vendorId, filterBy } = req.query;
    const where = { orgId: req.user.orgId };

    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;

    if (startDate || endDate) {
      if (filterBy === 'expiration') {
        // Filter by coverage expiration dates
        const dateConditions = [];
        const coverageFields = ['glExpirationDate', 'wcExpirationDate', 'umbExpirationDate', 'autoExpirationDate'];

        for (const field of coverageFields) {
          const condition = {};
          if (startDate && endDate) {
            condition[field] = { gte: new Date(startDate), lte: new Date(endDate) };
          } else if (startDate) {
            condition[field] = { gte: new Date(startDate) };
          } else {
            condition[field] = { lte: new Date(endDate) };
          }
          dateConditions.push(condition);
        }

        where.OR = dateConditions;
      } else {
        // Default: filter by submission date
        const dateFilters = [];
        const coverageTypes = ['gl', 'wc', 'umb', 'auto'];
        for (const type of coverageTypes) {
          const expirationField = `${type}ExpirationDate`;
          const filter = {};
          if (startDate) {
            filter[expirationField] = { gte: new Date(startDate) };
          }
          dateFilters.push(filter);
        }

        const submittedFilter = {};
        if (startDate) submittedFilter.gte = new Date(startDate);
        if (endDate) submittedFilter.lte = new Date(endDate);
        dateFilters.push({ submittedAt: submittedFilter });

        where.OR = dateFilters;
      }
    }

    const cois = await prisma.coi.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
    });

    // If filtering by expiration, annotate each COI with which coverages are expiring
    if (filterBy === 'expiration' && (startDate || endDate)) {
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;

      for (const coi of cois) {
        const expiringCoverages = [];
        const checks = [
          { field: 'glExpirationDate', label: 'General Liability' },
          { field: 'wcExpirationDate', label: 'Workers Comp' },
          { field: 'umbExpirationDate', label: 'Umbrella' },
          { field: 'autoExpirationDate', label: 'Automobile' },
        ];

        for (const { field, label } of checks) {
          if (!coi[field]) continue;
          const d = new Date(coi[field]);
          const inRange = (!start || d >= start) && (!end || d <= end);
          if (inRange) expiringCoverages.push(label);
        }

        coi.expiringCoverages = expiringCoverages;
      }
    }

    res.json(cois);
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/reports/expiring
router.get('/expiring', authenticate, async (req, res) => {
  try {
    const daysAhead = parseInt(req.query.days) || 30;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const cois = await prisma.coi.findMany({
      where: {
        orgId: req.user.orgId,
        status: 'APPROVED',
        OR: [
          { glExpirationDate: { lte: futureDate, gte: new Date() } },
          { wcExpirationDate: { lte: futureDate, gte: new Date() } },
          { umbExpirationDate: { lte: futureDate, gte: new Date() } },
          { autoExpirationDate: { lte: futureDate, gte: new Date() } },
        ],
      },
      include: {
        vendor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { glExpirationDate: 'asc' },
    });

    res.json(cois);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get expiring COIs' });
  }
});

// POST /api/reports/export-pdfs — merge matching COI PDFs into one download
router.post('/export-pdfs', authenticate, async (req, res) => {
  try {
    const { coiIds } = req.body;

    if (!Array.isArray(coiIds) || coiIds.length === 0) {
      return res.status(400).json({ error: 'No COI IDs provided' });
    }

    const cois = await prisma.coi.findMany({
      where: {
        id: { in: coiIds },
        orgId: req.user.orgId,
      },
      select: { pdfPath: true },
    });

    const validKeys = cois.filter(c => c.pdfPath).map(c => c.pdfPath);

    if (validKeys.length === 0) {
      return res.status(404).json({ error: 'No PDF files found for the selected COIs' });
    }

    const mergedPdf = await PDFDocument.create();

    for (const key of validKeys) {
      try {
        const pdfBytes = await downloadFile(key);
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        for (const page of pages) {
          mergedPdf.addPage(page);
        }
      } catch (err) {
        console.error(`[PDF Merge] Failed to process ${key}:`, err.message);
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      return res.status(500).json({ error: 'Failed to merge PDFs — no valid pages' });
    }

    const mergedBytes = await mergedPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="coi-export-${new Date().toISOString().split('T')[0]}.pdf"`);
    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'Failed to export PDFs' });
  }
});

module.exports = router;
