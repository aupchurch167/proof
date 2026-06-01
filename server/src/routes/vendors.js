const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { enforcePlanLimit } = require('../middleware/planLimits');
const { sendUploadRequestEmail } = require('../services/email');
const { extractCoiData } = require('../services/coiExtractor');
const { checkCompliance, updateVendorStatus } = require('../services/compliance');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/storage');
const { validate } = require('../utils/validation');
const { generateUploadToken } = require('../utils/tokens');
const { logAudit } = require('../services/audit');
const core = require('../lib/core');

const router = express.Router();

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

// Documents (W9 / Master Agreement) accept PDFs and common image types since
// Airtable historically stored W9s as phone photos (JPG/PNG/HEIC).
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF or image files are allowed'));
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
router.post('/', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), enforcePlanLimit('vendor'), validate('createVendor'), async (req, res) => {
  try {
    const { name, contactName, email, phone, address } = req.body;

    const vendor = await prisma.vendor.create({
      data: { orgId: req.user.orgId, name, contactName, email, phone, address },
    });

    // Replace default UUID token with a signed JWT
    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: { uploadToken: generateUploadToken(vendor.id) },
    });

    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'create', entity: 'vendor', entityId: updated.id, details: { name, email }, ipAddress: req.ip });

    mirrorCreateToCore(updated);

    res.status(201).json(updated);
  } catch (err) {
    console.error('Create vendor error:', err);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

async function mirrorCreateToCore(vendor) {
  if (!core.isEnabled()) return;
  try {
    const result = await core.createVendor(vendor);
    const coreId = result && result.data && result.data.id;
    if (coreId) {
      await prisma.vendor.update({ where: { id: vendor.id }, data: { coreId } });
    } else {
      console.warn('[Core] createVendor returned no id; vendor not linked', { vendorId: vendor.id });
    }
  } catch (err) {
    console.error('[Core] Failed to mirror vendor create:', core.formatError(err));
  }
}

async function mirrorUpdateToCore(vendor) {
  if (!core.isEnabled()) return;
  if (!vendor.coreId) {
    // No link yet — treat as a create so we don't drop the update.
    return mirrorCreateToCore(vendor);
  }
  try {
    await core.updateVendor(vendor.coreId, core.vendorToCorePayload(vendor));
  } catch (err) {
    console.error('[Core] Failed to mirror vendor update:', core.formatError(err));
  }
}

async function mirrorDeleteToCore(coreId) {
  if (!core.isEnabled() || !coreId) return;
  try {
    await core.updateVendor(coreId, { status: 'inactive' });
  } catch (err) {
    console.error('[Core] Failed to mirror vendor delete:', core.formatError(err));
  }
}

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

    const [w9Url, masterAgreementUrl] = await Promise.all([
      vendor.w9Path ? getSignedUrl(vendor.w9Path).catch(() => null) : null,
      vendor.masterAgreementPath ? getSignedUrl(vendor.masterAgreementPath).catch(() => null) : null,
    ]);

    res.json({ ...vendor, w9Url, masterAgreementUrl });
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

    mirrorUpdateToCore(updated);

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

    // Capture coreIds before soft-delete so we can mirror to Core after.
    const linked = await prisma.vendor.findMany({
      where: { id: { in: ids }, orgId: req.user.orgId, deletedAt: null, coreId: { not: null } },
      select: { coreId: true },
    });

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

    for (const v of linked) mirrorDeleteToCore(v.coreId);

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

    mirrorDeleteToCore(vendor.coreId);

    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'delete', entity: 'vendor', entityId: req.params.id, ipAddress: req.ip });
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
      ? checkCompliance(extractedData, settings, vendor.organization.name)
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
        certificateHolderName: extractedData.certificateHolderName || null,
        certificateHolderAddress: extractedData.certificateHolderAddress || null,
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

    // Rotate the upload token on every request. Catches vendors created via
    // the import scripts (where uploadToken is still the default UUID and the
    // portal can't jwt.verify() it) and also limits the lifetime of any
    // previously-shared link.
    const uploadToken = generateUploadToken(vendor.id);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { uploadToken } });

    const portalUrl = `${process.env.APP_URL}/portal/${uploadToken}`;

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

// POST /api/vendors/:id/documents — upload W9 and/or Master Agreement
router.post(
  '/:id/documents',
  authenticate,
  authorize('ADMIN', 'MEMBER', 'REVIEWER'),
  docUpload.fields([
    { name: 'w9', maxCount: 1 },
    { name: 'masterAgreement', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const vendor = await prisma.vendor.findFirst({
        where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
      });
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

      const w9 = req.files?.w9?.[0];
      const ma = req.files?.masterAgreement?.[0];
      if (!w9 && !ma) return res.status(400).json({ error: 'No files provided' });

      const data = {};
      if (w9) {
        const key = `${uuidv4()}${path.extname(w9.originalname) || ''}`;
        data.w9Path = await uploadFile(w9.buffer, key, w9.mimetype, 'w9s');
      }
      if (ma) {
        const key = `${uuidv4()}${path.extname(ma.originalname) || ''}`;
        data.masterAgreementPath = await uploadFile(ma.buffer, key, ma.mimetype, 'master-agreements');
      }

      const updated = await prisma.vendor.update({ where: { id: vendor.id }, data });

      const [w9Url, masterAgreementUrl] = await Promise.all([
        updated.w9Path ? getSignedUrl(updated.w9Path).catch(() => null) : null,
        updated.masterAgreementPath ? getSignedUrl(updated.masterAgreementPath).catch(() => null) : null,
      ]);

      logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'update', entity: 'vendor', entityId: updated.id, details: { uploaded: Object.keys(data) }, ipAddress: req.ip });
      res.json({ ...updated, w9Url, masterAgreementUrl });
    } catch (err) {
      console.error('Document upload error:', err);
      res.status(500).json({ error: 'Failed to upload documents' });
    }
  }
);

module.exports = router;
