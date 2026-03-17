const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

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
    const { startDate, endDate, status, vendorId } = req.query;
    const where = { orgId: req.user.orgId };

    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;

    // For audits: find COIs active during the date range
    // A COI is "active" if any of its expiration dates fall within or after the start date
    if (startDate || endDate) {
      const dateFilters = [];

      // COIs that have any coverage overlapping the audit period
      const coverageTypes = ['gl', 'wc', 'umb', 'auto'];
      for (const type of coverageTypes) {
        const expirationField = `${type}ExpirationDate`;
        const filter = {};

        if (startDate) {
          // Expiration must be on or after the audit start
          filter[expirationField] = { gte: new Date(startDate) };
        }

        dateFilters.push(filter);
      }

      // Also include COIs submitted during the range
      const submittedFilter = {};
      if (startDate) submittedFilter.gte = new Date(startDate);
      if (endDate) submittedFilter.lte = new Date(endDate);
      dateFilters.push({ submittedAt: submittedFilter });

      where.OR = dateFilters;
    }

    const cois = await prisma.coi.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
    });

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

module.exports = router;
