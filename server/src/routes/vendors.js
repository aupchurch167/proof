const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { enforcePlanLimit } = require('../middleware/planLimits');
const { sendUploadRequestEmail } = require('../services/email');
const { extractCoiData } = require('../services/coiExtractor');
const { checkCompliance, updateVendorStatus } = require('../services/compliance');
const { uploadFile, deleteFile } = require('../services/storage');

const router = express.Router();
const prisma = new PrismaClient();

const upload = multer({
  storage: multer.memoryStorage(),
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
          select: { id: true, status: true, submittedAt: true, coverageType: true, glExpirationDate: true },
        },
      },
    });

    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list vendors' });
  }
});

// POST /api/vendors
router.post('/', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), enforcePlanLimit('vendor'), async (req, res) => {
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
router.put('/:id', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), async (req, res) => {
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
router.delete('/bulk', authenticate, authorize('ADMIN', 'MEMBER'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    // Delete COI files from Spaces, then delete records
    const coisToDelete = await prisma.coi.findMany({
      where: { vendorId: { in: ids }, orgId: req.user.orgId },
      select: { pdfPath: true },
    });
    for (const c of coisToDelete) {
      if (c.pdfPath) {
        await deleteFile(c.pdfPath).catch(err => console.error('[Storage] Delete failed:', err.message));
      }
    }

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
router.delete('/:id', authenticate, authorize('ADMIN', 'MEMBER'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Delete COI files from Spaces, then delete records
    const vendorCois = await prisma.coi.findMany({
      where: { vendorId: req.params.id, orgId: req.user.orgId },
      select: { pdfPath: true },
    });
    for (const c of vendorCois) {
      if (c.pdfPath) {
        await deleteFile(c.pdfPath).catch(err => console.error('[Storage] Delete failed:', err.message));
      }
    }

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
router.post('/:id/coi/upload', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), enforcePlanLimit('coi'), upload.single('pdf'), async (req, res) => {
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

    // Upload to DigitalOcean Spaces
    const filename = `${uuidv4()}${path.extname(req.file.originalname)}`;
    const pdfPath = await uploadFile(req.file.buffer, filename, req.file.mimetype);

    // Extract data with Claude AI
    let extractedData = null;
    try {
      extractedData = await extractCoiData(req.file.buffer);
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
        coverageType: extractedData.coverageType || null,
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
router.post('/:id/request-coi', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
      include: { organization: { select: { name: true, email: true, address: true } } },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const portalUrl = `${process.env.APP_URL}/portal/${vendor.uploadToken}`;

    await sendUploadRequestEmail(vendor.email, vendor.name, portalUrl, vendor.organization);

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
