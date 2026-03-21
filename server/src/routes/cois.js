const express = require('express');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { updateVendorStatus } = require('../services/compliance');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/cois
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, vendorId, startDate, endDate } = req.query;
    const where = { orgId: req.user.orgId };

    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;
    if (startDate || endDate) {
      where.submittedAt = {};
      if (startDate) where.submittedAt.gte = new Date(startDate);
      if (endDate) where.submittedAt.lte = new Date(endDate);
    }

    const cois = await prisma.coi.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.json(cois);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list COIs' });
  }
});

// GET /api/cois/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
      include: {
        vendor: true,
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }

    res.json(coi);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get COI' });
  }
});

// GET /api/cois/:id/pdf
router.get('/:id/pdf', authenticate, async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
      select: { pdfPath: true },
    });

    if (!coi || !coi.pdfPath) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    const filePath = path.join(__dirname, '../../uploads', coi.pdfPath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF file not found on disk' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${coi.pdfPath}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('PDF download error:', err);
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// PUT /api/cois/:id
router.put('/:id', authenticate, authorize('ADMIN', 'REVIEWER'), async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }

    const allowedFields = [
      'glPolicyNumber', 'glCoverageAmount', 'glExpirationDate',
      'wcPolicyNumber', 'wcCoverageAmount', 'wcExpirationDate',
      'umbPolicyNumber', 'umbCoverageAmount', 'umbExpirationDate',
      'autoPolicyNumber', 'autoCoverageAmount', 'autoExpirationDate',
      'agentName', 'agentEmail', 'agentPhone', 'insuranceCompany',
    ];

    const data = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field.endsWith('Date') && req.body[field]) {
          data[field] = new Date(req.body[field]);
        } else {
          data[field] = req.body[field];
        }
      }
    }

    const updated = await prisma.coi.update({
      where: { id: req.params.id },
      data,
      include: { vendor: true },
    });

    res.json(updated);
  } catch (err) {
    console.error('Update COI error:', err);
    res.status(500).json({ error: 'Failed to update COI' });
  }
});

// POST /api/cois/:id/approve
router.post('/:id/approve', authenticate, authorize('ADMIN', 'REVIEWER'), async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }

    const updated = await prisma.coi.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        reviewNotes: req.body.notes || null,
      },
    });

    await updateVendorStatus(prisma, coi.vendorId, coi.orgId);

    res.json(updated);
  } catch (err) {
    console.error('Approve COI error:', err);
    res.status(500).json({ error: 'Failed to approve COI' });
  }
});

// DELETE /api/cois/:id
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
      include: { vendor: true },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }

    await prisma.coi.delete({
      where: { id: req.params.id },
    });

    await updateVendorStatus(prisma, coi.vendorId, coi.orgId);

    res.json({ message: 'COI deleted' });
  } catch (err) {
    console.error('Delete COI error:', err);
    res.status(500).json({ error: 'Failed to delete COI' });
  }
});

// POST /api/cois/:id/reject
router.post('/:id/reject', authenticate, authorize('ADMIN', 'REVIEWER'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason required' });
    }

    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
      include: { vendor: true },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }

    const updated = await prisma.coi.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        reviewNotes: reason,
      },
    });

    await updateVendorStatus(prisma, coi.vendorId, coi.orgId);

    // Send rejection notification
    const { sendRejectionEmail } = require('../services/email');
    const portalUrl = `${process.env.APP_URL}/portal/${coi.vendor.uploadToken}`;
    await sendRejectionEmail(coi.vendor.email, coi.vendor.name, reason, portalUrl).catch(console.error);

    await prisma.notificationLog.create({
      data: {
        orgId: coi.orgId,
        vendorId: coi.vendorId,
        coiId: coi.id,
        type: 'COI_REJECTED',
        recipientEmail: coi.vendor.email,
        status: 'SENT',
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('Reject COI error:', err);
    res.status(500).json({ error: 'Failed to reject COI' });
  }
});

module.exports = router;
