const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { sendUploadRequestEmail } = require('../services/email');
const { extractCoiData } = require('../services/coiExtractor');
const { checkCompliance, updateVendorStatus } = require('../services/compliance');

const router = express.Router();
const prisma = new PrismaClient();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

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

// DELETE /api/vendors/bulk (soft delete multiple, hard delete COIs first)
router.delete('/bulk', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    // First, delete all COIs for these vendors (hard delete)
    await prisma.coi.deleteMany({
      where: { vendorId: { in: ids }, orgId: req.user.orgId },
    });

    // Then, soft-delete the vendors
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

// DELETE /api/vendors/:id (soft delete, hard delete COIs first)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Delete all COIs for this vendor (hard delete)
    await prisma.coi.deleteMany({
      where: { vendorId: req.params.id, orgId: req.user.orgId },
    });

    // Then soft-delete the vendor
    await prisma.vendor.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });

    res.json({ message: 'Vendor deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
});

// POST /api/vendors/:id/coi/upload (admin-authenticated upload)
router.post('/:id/coi/upload', authenticate, authorize('ADMIN', 'REVIEWER'), upload.single('pdf'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
      include: { organization: { include: { settings: true } } },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'PDF file required' });
    }

    const pdfPath = req.file.filename;

    // Extract data with Claude AI
    let extractedData = null;
    try {
      extractedData = await extractCoiData(path.join(__dirname, '../../uploads', pdfPath));
    } catch (extractErr) {
      console.error('AI extraction failed:', extractErr);
    }

    // Check compliance against org requirements
    const settings = vendor.organization.settings;
    const complianceFlags = settings && extractedData
      ? checkCompliance(extractedData, settings)
      : null;

    // Create COI record
    const coiData = {
      vendorId: vendor.id,
      orgId: vendor.orgId,
      pdfPath,
      status: 'PENDING_REVIEW',
      aiExtractedData: extractedData,
      complianceFlags,
    };

    if (extractedData) {
      Object.assign(coiData, {
        glPolicyNumber: extractedData.glPolicyNumber || null,
        glCoverageAmount: extractedData.glCoverageAmount || null,
        glExpirationDate: extractedData.glExpirationDate ? new Date(extractedData.glExpirationDate) : null,
        wcPolicyNumber: extractedData.wcPolicyNumber || null,
        wcCoverageAmount: extractedData.wcCoverageAmount || null,
        wcExpirationDate: extractedData.wcExpirationDate ? new Date(extractedData.wcExpirationDate) : null,
        umbPolicyNumber: extractedData.umbPolicyNumber || null,
        umbCoverageAmount: extractedData.umbCoverageAmount || null,
        umbExpirationDate: extractedData.umbExpirationDate ? new Date(extractedData.umbExpirationDate) : null,
        autoPolicyNumber: extractedData.autoPolicyNumber || null,
        autoCoverageAmount: extractedData.autoCoverageAmount || null,
        autoExpirationDate: extractedData.autoExpirationDate ? new Date(extractedData.autoExpirationDate) : null,
        agentName: extractedData.agentName || null,
        agentEmail: extractedData.agentEmail || null,
        agentPhone: extractedData.agentPhone || null,
        insuranceCompany: extractedData.insuranceCompany || null,
      });
    }

    const coi = await prisma.coi.create({ data: coiData });

    // Update vendor status
    await updateVendorStatus(prisma, vendor.id, vendor.orgId);

    res.status(201).json({
      message: 'COI uploaded successfully',
      coiId: coi.id,
      complianceFlags,
    });
  } catch (err) {
    console.error('COI upload error:', err);
    res.status(500).json({ error: 'Failed to upload COI' });
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
