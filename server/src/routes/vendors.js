const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const { authenticateVerified: authenticate, authorize } = require('../middleware/auth');
const { omitVendorSecrets } = require('../http/sanitize');
const { enforcePlanLimit } = require('../middleware/planLimits');
const { sendUploadRequestEmail } = require('../services/email');
const { extractCoiData } = require('../services/coiExtractor');
const { isExtractLimitError } = require('../lib/extractErrors');
const { rejectUnlessPdfMagic } = require('../utils/uploadFilters');
const { checkCompliance, updateVendorStatus } = require('../services/compliance');
const { coverageFor, coverageReason } = require('../services/coverage');
const { uploadFile, getSignedUrl } = require('../services/storage');
const { validate } = require('../utils/validation');
const { generateUploadToken } = require('../utils/tokens');
const { isVendorEmailConflict } = require('../lib/prismaErrors');
const { isPlaceholderEmail, placeholderReason } = require('../utils/email');
const { logAudit } = require('../services/audit');
const core = require('../lib/core');
const { isValidTrade, CANONICAL_TRADES } = require('../constants/trades');

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
    const { status, search, trade } = req.query;
    const where = { orgId: req.user.orgId, deletedAt: null };

    if (status) where.coiStatus = status;
    if (trade) where.trade = trade;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Newest-first COIs per vendor: the first row drives the "latest COI"
    // column, the first APPROVED one drives the coverage chips. One include
    // serves both, so the list stays a single query.
    const [vendors, settings] = await Promise.all([
      prisma.vendor.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          cois: {
            where: { deletedAt: null },
            orderBy: { submittedAt: 'desc' },
            select: {
              id: true, status: true, submittedAt: true, coverageType: true,
              glCoverageAmount: true, glExpirationDate: true, glPolicyNumber: true,
              autoCoverageAmount: true, autoExpirationDate: true, autoPolicyNumber: true,
              wcCoverageAmount: true, wcExpirationDate: true, wcPolicyNumber: true,
              umbCoverageAmount: true, umbExpirationDate: true, umbPolicyNumber: true,
            },
          },
        },
      }),
      prisma.organizationSettings.findUnique({ where: { orgId: req.user.orgId } }),
    ]);

    const now = new Date();
    res.json(vendors.map((vendor) => {
      const latestApproved = vendor.cois.find((c) => c.status === 'APPROVED') || null;
      const coverages = coverageFor(latestApproved, settings, { now });
      return omitVendorSecrets({
        ...vendor,
        // The list only ever renders the newest certificate.
        cois: vendor.cois.slice(0, 1),
        coverages,
        statusReason: coverageReason(coverages),
        nextExpiration: coverages
          .filter((c) => c.expiresAt && c.verdict !== 'skipped')
          .map((c) => c.expiresAt)
          .sort()[0] || null,
      });
    }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to list vendors' });
  }
});

// GET /api/vendors/trades — canonical trade list for dropdowns
router.get('/trades', authenticate, (req, res) => {
  res.json(CANONICAL_TRADES);
});

// POST /api/vendors
router.post('/', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), enforcePlanLimit('vendor'), validate('createVendor'), async (req, res) => {
  try {
    const { name, contactName, email, phone, address, trade, additionalEmails } = req.body;

    if (trade && !isValidTrade(trade)) {
      return res.status(400).json({ error: 'Invalid trade value' });
    }

    const vendor = await prisma.vendor.create({
      data: {
        orgId: req.user.orgId, name, contactName, email, phone, address,
        trade: trade || null,
        additionalEmails: Array.isArray(additionalEmails) ? additionalEmails : [],
      },
    });

    // Replace default UUID token with a signed JWT
    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: { uploadToken: generateUploadToken(vendor.id) },
    });

    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'create', entity: 'vendor', entityId: updated.id, details: { name, email }, ipAddress: req.ip });

    mirrorCreateToCore(updated);

    res.status(201).json(omitVendorSecrets(updated));
  } catch (err) {
    if (isVendorEmailConflict(err)) {
      return res.status(409).json({
        error: 'A vendor with this email already exists',
        code: 'VENDOR_EMAIL_CONFLICT',
      });
    }
    console.error('Create vendor error:', err);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

async function mirrorCreateToCore(vendor) {
  if (!core.isEnabled() || !(await core.shouldMirror(vendor))) return;
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
  if (!core.isEnabled() || !(await core.shouldMirror(vendor))) return;
  if (!vendor.coreId) {
    // No link yet — treat as a create so we don't drop the update.
    return mirrorCreateToCore(vendor);
  }
  try {
    await core.updateVendor(vendor.coreId, core.vendorToCorePayload(vendor), vendor);
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

async function maybeAddAgentEmail(prisma, vendorId, agentEmail, currentAdditionalEmails) {
  if (!agentEmail) return;
  const normalized = agentEmail.trim().toLowerCase();
  const existing = (currentAdditionalEmails || []).map(e => e.toLowerCase());
  if (existing.includes(normalized)) return;
  await prisma.vendor.update({
    where: { id: vendorId },
    data: { additionalEmails: { push: agentEmail.trim() } },
  });
}

// GET /api/vendors/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
      include: {
        cois: { where: { deletedAt: null }, orderBy: { submittedAt: 'desc' } },
      },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const [w9Url, masterAgreementUrl, lastCoiRequest] = await Promise.all([
      vendor.w9Path ? getSignedUrl(vendor.w9Path).catch(() => null) : null,
      vendor.masterAgreementPath ? getSignedUrl(vendor.masterAgreementPath).catch(() => null) : null,
      prisma.notificationLog.findFirst({
        where: { vendorId: vendor.id, type: 'UPLOAD_REQUEST', status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
    ]);

    const settings = await prisma.organizationSettings.findUnique({
      where: { orgId: req.user.orgId },
    });
    const latestApproved = vendor.cois.find((c) => c.status === 'APPROVED') || null;
    const coverages = coverageFor(latestApproved, settings, {});

    res.json(omitVendorSecrets({
      ...vendor,
      w9Url,
      masterAgreementUrl,
      lastCoiRequestAt: lastCoiRequest?.sentAt || null,
      coverages,
      statusReason: coverageReason(coverages),
      // The certificate list marks anything older than the newest approved one
      // for the same coverage as superseded rather than just "approved".
      supersededCoiIds: latestApproved
        ? vendor.cois.filter((c) => c.status === 'APPROVED' && c.id !== latestApproved.id).map((c) => c.id)
        : [],
    }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get vendor' });
  }
});

// PUT /api/vendors/:id
router.put('/:id', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), validate('updateVendor'), async (req, res) => {
  try {
    const { name, contactName, email, phone, address, trade, additionalEmails } = req.body;

    if (trade && !isValidTrade(trade)) {
      return res.status(400).json({ error: 'Invalid trade value' });
    }

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
        ...(trade !== undefined && { trade: trade || null }),
        ...(additionalEmails !== undefined && { additionalEmails: Array.isArray(additionalEmails) ? additionalEmails : [] }),
      },
    });

    mirrorUpdateToCore(updated);

    res.json(omitVendorSecrets(updated));
  } catch (err) {
    if (isVendorEmailConflict(err)) {
      return res.status(409).json({
        error: 'A vendor with this email already exists',
        code: 'VENDOR_EMAIL_CONFLICT',
      });
    }
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

async function softDeleteVendorsAndCois(tx, { ids, orgId, now = new Date() }) {
  await tx.coi.updateMany({
    where: { vendorId: { in: ids }, orgId, deletedAt: null },
    data: { deletedAt: now },
  });
  return tx.vendor.updateMany({
    where: { id: { in: ids }, orgId, deletedAt: null },
    data: { deletedAt: now },
  });
}

// DELETE /api/vendors/bulk (soft-delete vendors and COIs; keep Spaces objects)
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

    const { count } = await prisma.$transaction((tx) => (
      softDeleteVendorsAndCois(tx, { ids, orgId: req.user.orgId })
    ));

    for (const v of linked) mirrorDeleteToCore(v.coreId);

    res.json({ message: `${count} vendor(s) deleted` });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: 'Failed to delete vendors' });
  }
});

// DELETE /api/vendors/:id (soft-delete vendor and COIs; keep Spaces objects)
router.delete('/:id', authenticate, authorize('ADMIN', 'MEMBER'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    await prisma.$transaction((tx) => (
      softDeleteVendorsAndCois(tx, { ids: [vendor.id], orgId: req.user.orgId })
    ));

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
    if (!rejectUnlessPdfMagic(req, res)) return;

    // Upload to DigitalOcean Spaces
    const filename = `${uuidv4()}${path.extname(req.file.originalname)}`;
    const pdfPath = await uploadFile(req.file.buffer, filename, req.file.mimetype);

    // Extract data with Claude AI
    let extractedData = null;
    let extractionError = null;
    try {
      extractedData = await extractCoiData(req.file.buffer, { orgId: vendor.orgId });
    } catch (extractErr) {
      if (isExtractLimitError(extractErr)) {
        return res.status(extractErr.status).json({ error: extractErr.message, code: extractErr.code });
      }
      extractionError = extractErr.message;
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

    // Auto-add agent email to vendor's additional emails
    if (extractedData?.agentEmail) {
      await maybeAddAgentEmail(prisma, vendor.id, extractedData.agentEmail, vendor.additionalEmails);
    }

    // Update vendor status
    await updateVendorStatus(prisma, vendor.id, vendor.orgId);

    res.status(201).json({
      message: 'COI uploaded successfully',
      coiId: coi.id,
      complianceFlags,
      extractionError,
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

    // Vendors imported without a contact address carry a synthesized one that
    // will never deliver. Record the attempt as FAILED so the cockpit can flag
    // the vendor, and tell the caller to fix the address instead.
    if (isPlaceholderEmail(vendor.email)) {
      await prisma.notificationLog.create({
        data: {
          orgId: req.user.orgId,
          vendorId: vendor.id,
          type: 'UPLOAD_REQUEST',
          recipientEmail: vendor.email,
          status: 'FAILED',
          meta: { reason: placeholderReason(vendor.email) },
        },
      });
      return res.status(400).json({
        error: 'This vendor has no deliverable email address on file',
        code: 'BAD_EMAIL',
      });
    }

    // Default 24-hour cooldown so a stray click (or a tab left open) can't
    // blast the vendor with multiple identical emails. Caller can override
    // with `force: true` after a confirmation prompt.
    const COOLDOWN_MS = 24 * 60 * 60 * 1000;
    if (!req.body?.force) {
      const recent = await prisma.notificationLog.findFirst({
        where: {
          vendorId: vendor.id,
          type: 'UPLOAD_REQUEST',
          status: 'SENT',
          sentAt: { gte: new Date(Date.now() - COOLDOWN_MS) },
        },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      });
      if (recent) {
        return res.status(429).json({
          error: 'A COI request was sent recently to this vendor',
          code: 'RECENT_REQUEST',
          lastSentAt: recent.sentAt,
        });
      }
    }

    // Rotate the upload token on every request. Catches vendors created via
    // the import scripts (where uploadToken is still the default UUID and the
    // portal can't jwt.verify() it) and also limits the lifetime of any
    // previously-shared link.
    const uploadToken = generateUploadToken(vendor.id);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { uploadToken } });

    const portalUrl = `${process.env.APP_URL}/portal/${uploadToken}`;

    const cc = vendor.additionalEmails?.length > 0 ? vendor.additionalEmails : undefined;
    const sent = await sendUploadRequestEmail(vendor.email, vendor.name, portalUrl, vendor.organization, cc);

    const log = await prisma.notificationLog.create({
      data: {
        orgId: req.user.orgId,
        vendorId: vendor.id,
        type: 'UPLOAD_REQUEST',
        recipientEmail: vendor.email,
        status: 'SENT',
        ...(sent?.id && { meta: { emailId: sent.id } }),
      },
    });

    res.json({ message: 'COI request sent', lastSentAt: log.sentAt });
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
