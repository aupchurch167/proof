const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const { coverageFor } = require('../services/coverage');
const { mergeApprovedCois } = require('../services/effectiveCoverage');
const { authenticateVerified: authenticate, authorize } = require('../middleware/auth');
const { extractCoiData } = require('../services/coiExtractor');
const { isExtractLimitError } = require('../lib/extractErrors');
const { rejectUnlessPdfMagic, rejectNonPdfUpload } = require('../utils/uploadFilters');
const { checkCompliance } = require('../services/compliance');
const { sendUploadNotificationEmail } = require('../services/email');
const { evaluatePlanLimit } = require('../middleware/planLimits');
const { uploadFile } = require('../services/storage');
const { verifyUploadToken } = require('../utils/tokens');
const { phoneFieldError, addressFieldError } = require('../utils/vendorContact');
const { logAudit } = require('../services/audit');

const router = express.Router();

function markPreview(req, _res, next) {
  req.portalPreview = true;
  next();
}

const previewGate = [authenticate, authorize('ADMIN'), markPreview];

async function loadPortalVendor(req, res, query = {}) {
  // Admin preview uses the signed-in session. The URL carries no token, so a
  // copied link, screenshot, or Referer header cannot open the portal.
  if (req.portalPreview) {
    const vendor = await prisma.vendor.findFirst({
      where: { orgId: req.user.orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      ...query,
    });
    if (!vendor) {
      res.status(404).json({ error: 'Add a vendor to preview the portal', orgName: null });
      return null;
    }
    return vendor;
  }

  let payload;
  try {
    payload = verifyUploadToken(req.params.uploadToken);
  } catch (err) {
    res.status(401).json({ error: 'Upload link has expired or is invalid', orgName: null });
    return null;
  }
  if (!payload.vendorId) {
    res.status(401).json({ error: 'Upload link has expired or is invalid', orgName: null });
    return null;
  }

  const vendor = await prisma.vendor.findFirst({
    where: { id: payload.vendorId, deletedAt: null },
    ...query,
  });
  if (!vendor) {
    res.status(404).json({ error: 'Upload link has expired or is invalid', orgName: null });
    return null;
  }
  return vendor;
}

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

// GET /api/portal/preview — admin session, no credential in the URL.
router.get('/preview', ...previewGate, async (req, res) => getPortal(req, res));

// GET /api/portal/:uploadToken
router.get('/:uploadToken', async (req, res) => getPortal(req, res));

async function getPortal(req, res) {
  try {
    const vendor = await loadPortalVendor(req, res, {
      select: {
        id: true, name: true, contactName: true, email: true, phone: true, address: true,
        orgId: true,
        organization: {
          select: { id: true, name: true, email: true, address: true, additionalInsuredNote: true },
        },
        cois: {
          where: { status: 'APPROVED', deletedAt: null },
          orderBy: { submittedAt: 'desc' },
        },
      },
    });
    if (!vendor) return;

    // The portal has to tell a vendor exactly what to send, so it carries the
    // org's requirements and what is currently on file for them.
    const settings = await prisma.organizationSettings.findUnique({
      where: { orgId: vendor.orgId },
    });
    const coverages = coverageFor(mergeApprovedCois(vendor.cois), settings, {});

    const { cois, orgId, ...rest } = vendor;
    res.json({
      ...rest,
      coverages,
      // What prompted this request, so the page can open with the right line.
      expiringSoonest: coverages
        .filter((c) => c.expiresAt && c.verdict !== 'skipped')
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0] || null,
      hasCoiOnFile: cois.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load portal' });
  }
}

router.put('/preview/info', ...previewGate, async (req, res) => updatePortalInfo(req, res));

// PUT /api/portal/:uploadToken/info
router.put('/:uploadToken/info', async (req, res) => updatePortalInfo(req, res));

async function updatePortalInfo(req, res) {
  try {
    const { name, contactName, email, phone, address } = req.body;
    if (name && String(name).trim().length > 200) {
      return res.status(400).json({ error: 'Vendor name must be 200 characters or fewer' });
    }
    if (phone !== undefined) {
      const phoneError = phoneFieldError(phone);
      if (phoneError) return res.status(400).json({ error: phoneError });
    }
    if (address !== undefined) {
      const addressError = addressFieldError(address);
      if (addressError) return res.status(400).json({ error: addressError });
    }

    const vendor = await loadPortalVendor(req, res);
    if (!vendor) return;

    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        ...(name && { name }),
        ...(contactName !== undefined && { contactName }),
        ...(email && { email }),
        ...(phone !== undefined && { phone: phone == null ? null : String(phone).trim() || null }),
        ...(address !== undefined && { address: address == null ? null : String(address).trim() || null }),
      },
      select: { id: true, name: true, contactName: true, email: true, phone: true, address: true },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update info' });
  }
}

router.post('/preview/upload', ...previewGate, rejectNonPdfUpload(upload, 'pdf'), async (req, res) => uploadPortalPdf(req, res));

// POST /api/portal/:uploadToken/upload
router.post('/:uploadToken/upload', rejectNonPdfUpload(upload, 'pdf'), async (req, res) => uploadPortalPdf(req, res));

async function uploadPortalPdf(req, res) {
  try {
    const vendor = await loadPortalVendor(req, res, {
      include: { organization: { include: { settings: true } } },
    });
    if (!vendor) return;

    if (!req.file) {
      return res.status(400).json({ error: 'PDF file required' });
    }
    if (!rejectUnlessPdfMagic(req, res)) return;

    // Same cap as staff upload. Soft-deleted certificates do not count.
    const coiLimit = await evaluatePlanLimit(vendor.orgId, 'coi');
    if (!coiLimit.ok) {
      return res.status(403).json({
        error: 'This organization has reached its COI limit. Please contact them to resolve this.',
        code: 'PLAN_LIMIT_EXCEEDED',
      });
    }

    // Upload to DigitalOcean Spaces
    const filename = `${uuidv4()}${path.extname(req.file.originalname)}`;
    const pdfPath = await uploadFile(req.file.buffer, filename, req.file.mimetype);

    // Extract data with Claude AI
    let extractedData = null;
    try {
      extractedData = await extractCoiData(req.file.buffer, { orgId: vendor.orgId });
    } catch (extractErr) {
      if (isExtractLimitError(extractErr)) {
        return res.status(extractErr.status).json({ error: extractErr.message, code: extractErr.code });
      }
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

    await logAudit({
      orgId: vendor.orgId,
      userId: null,
      action: 'create',
      entity: 'coi',
      entityId: coi.id,
      details: { vendorName: vendor.name, name: vendor.name, source: 'portal' },
      ipAddress: req.ip,
    });

    // Auto-add agent email to vendor's additional emails
    if (extractedData?.agentEmail) {
      const agentEmail = extractedData.agentEmail.trim();
      const normalized = agentEmail.toLowerCase();
      const existing = (vendor.additionalEmails || []).map(e => e.toLowerCase());
      if (!existing.includes(normalized)) {
        await prisma.vendor.update({
          where: { id: vendor.id },
          data: { additionalEmails: { push: agentEmail } },
        });
      }
    }

    // Update vendor status
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { coiStatus: 'PENDING' },
    });

    // Notify org admins
    if (settings?.notifyOnUpload) {
      const admins = await prisma.user.findMany({
        where: { orgId: vendor.orgId, role: 'ADMIN' },
        select: { email: true },
      });

      for (const admin of admins) {
        await sendUploadNotificationEmail(admin.email, vendor.name).catch(console.error);
      }
    }

    res.status(201).json({
      message: 'COI uploaded successfully',
      coiId: coi.id,
      complianceFlags,
    });
  } catch (err) {
    console.error('Portal upload error:', err);
    res.status(500).json({ error: 'Failed to upload COI' });
  }
}

module.exports = router;
