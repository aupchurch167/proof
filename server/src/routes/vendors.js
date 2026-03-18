const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { sendUploadRequestEmail } = require('../services/email');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/vendors
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, search } = req.query;
    const where = { orgId: req.user.orgId, deletedAt: null };

    if (status) where.coiStatus = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const vendors = await prisma.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        cois: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { id: true, status: true, submittedAt: true, glExpirationDate: true },
        },
      },
    });

    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list vendors' });
  }
});

// POST /api/vendors
router.post('/', authenticate, authorize('ADMIN', 'REVIEWER'), async (req, res) => {
  try {
    const { name, contactName, email, phone, address } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email required' });
    }

    const vendor = await prisma.vendor.create({
      data: { orgId: req.user.orgId, name, contactName, email, phone, address },
    });

    res.status(201).json(vendor);
  } catch (err) {
    console.error('Create vendor error:', err);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

// GET /api/vendors/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
      include: {
        cois: { orderBy: { submittedAt: 'desc' } },
      },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    res.json(vendor);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get vendor' });
  }
});

// PUT /api/vendors/:id
router.put('/:id', authenticate, authorize('ADMIN', 'REVIEWER'), async (req, res) => {
  try {
    const { name, contactName, email, phone, address } = req.body;

    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const updated = await prisma.vendor.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(contactName !== undefined && { contactName }),
        ...(email && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
      },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

// DELETE /api/vendors/bulk (soft delete multiple)
router.delete('/bulk', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const { count } = await prisma.vendor.updateMany({
      where: { id: { in: ids }, orgId: req.user.orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    res.json({ message: `${count} vendor(s) deleted` });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: 'Failed to delete vendors' });
  }
});

// DELETE /api/vendors/:id (soft delete)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    await prisma.vendor.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });

    res.json({ message: 'Vendor deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
});

// POST /api/vendors/:id/request-coi
router.post('/:id/request-coi', authenticate, authorize('ADMIN', 'REVIEWER'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const portalUrl = `${process.env.APP_URL}/portal/${vendor.uploadToken}`;

    await sendUploadRequestEmail(vendor.email, vendor.name, portalUrl);

    await prisma.notificationLog.create({
      data: {
        orgId: req.user.orgId,
        vendorId: vendor.id,
        type: 'UPLOAD_REQUEST',
        recipientEmail: vendor.email,
        status: 'SENT',
      },
    });

    res.json({ message: 'COI request sent' });
  } catch (err) {
    console.error('Request COI error:', err);
    res.status(500).json({ error: 'Failed to send COI request' });
  }
});

module.exports = router;
