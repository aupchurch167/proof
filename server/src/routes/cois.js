const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { updateVendorStatus, checkCompliance } = require('../services/compliance');
const { getSignedUrl, deleteFile, downloadFile } = require('../services/storage');
const { extractCoiData } = require('../services/coiExtractor');
const { z } = require('zod');
const { logAudit } = require('../services/audit');

// Map an AI extraction result onto the COI's editable columns. Shared by the
// re-analyze route and mirrors the mapping used on first upload.
function extractedToCoiData(extractedData) {
  return {
    aiExtractedData: extractedData,
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
  };
}

const router = express.Router();

// Not `.strict()`: the client sends the whole COI object back (including id,
// vendor, etc.), so unknown keys are stripped rather than rejected. Only the
// whitelisted `allowedFields` below are ever written. `coverageType` and the
// amounts must accept null so a reviewer can clear a field.
const coiUpdateSchema = z.object({
  coverageType: z.string().nullable().optional(),
  glPolicyNumber: z.string().nullable().optional(),
  glCoverageAmount: z.number().nullable().optional(),
  glExpirationDate: z.string().nullable().optional(),
  wcPolicyNumber: z.string().nullable().optional(),
  wcCoverageAmount: z.number().nullable().optional(),
  wcExpirationDate: z.string().nullable().optional(),
  umbPolicyNumber: z.string().nullable().optional(),
  umbCoverageAmount: z.number().nullable().optional(),
  umbExpirationDate: z.string().nullable().optional(),
  autoPolicyNumber: z.string().nullable().optional(),
  autoCoverageAmount: z.number().nullable().optional(),
  autoExpirationDate: z.string().nullable().optional(),
  agentName: z.string().nullable().optional(),
  // Tolerate an empty string (a cleared field) in addition to a valid email/null.
  agentEmail: z.union([z.string().email('Invalid agent email'), z.literal('')]).nullable().optional(),
  agentPhone: z.string().nullable().optional(),
  insuranceCompany: z.string().nullable().optional(),
  certificateHolderName: z.string().nullable().optional(),
  certificateHolderAddress: z.string().nullable().optional(),
});

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
        organization: { select: { name: true } },
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

    const signedUrl = await getSignedUrl(coi.pdfPath);
    res.json({ url: signedUrl });
  } catch (err) {
    console.error('PDF download error:', err);
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// PUT /api/cois/:id
router.put('/:id', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), async (req, res) => {
  try {
    const parseResult = coiUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      const message = parseResult.error.issues.map(e => e.message).join(', ');
      return res.status(400).json({ error: message });
    }

    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }

    const allowedFields = [
      'coverageType',
      'glPolicyNumber', 'glCoverageAmount', 'glExpirationDate',
      'wcPolicyNumber', 'wcCoverageAmount', 'wcExpirationDate',
      'umbPolicyNumber', 'umbCoverageAmount', 'umbExpirationDate',
      'autoPolicyNumber', 'autoCoverageAmount', 'autoExpirationDate',
      'agentName', 'agentEmail', 'agentPhone', 'insuranceCompany',
      'certificateHolderName', 'certificateHolderAddress',
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

// POST /api/cois/:id/reanalyze — re-run AI extraction on the stored PDF and
// overwrite the COI's extracted data + compliance flags. Useful mid-review when
// the first extraction failed (e.g. the API key was missing) or was poor.
router.post('/:id/reanalyze', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
      include: { organization: { include: { settings: true } } },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }
    if (!coi.pdfPath) {
      return res.status(400).json({ error: 'This COI has no PDF to analyze' });
    }

    let buffer;
    try {
      buffer = await downloadFile(coi.pdfPath);
    } catch (err) {
      console.error('Reanalyze download failed:', err);
      return res.status(502).json({ error: 'Could not retrieve the COI PDF' });
    }

    let extractedData = null;
    let extractionError = null;
    try {
      extractedData = await extractCoiData(buffer);
    } catch (err) {
      extractionError = err.message;
      console.error('Reanalyze extraction failed:', err);
    }

    if (!extractedData) {
      // Surface the real reason (e.g. missing API key) so an admin can act on it.
      return res.status(422).json({ error: extractionError || 'AI extraction returned no data' });
    }

    const settings = coi.organization.settings;
    const complianceFlags = settings
      ? checkCompliance(extractedData, settings, coi.organization.name)
      : null;

    const updated = await prisma.coi.update({
      where: { id: coi.id },
      data: { ...extractedToCoiData(extractedData), complianceFlags },
      include: {
        vendor: true,
        organization: { select: { name: true } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Recompute vendor status in case this COI is already approved and the
    // coverage figures changed.
    await updateVendorStatus(prisma, coi.vendorId, coi.orgId);
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'reanalyze', entity: 'coi', entityId: coi.id, ipAddress: req.ip });

    res.json(updated);
  } catch (err) {
    console.error('Reanalyze COI error:', err);
    res.status(500).json({ error: 'Failed to re-analyze COI' });
  }
});

// POST /api/cois/:id/approve
router.post('/:id/approve', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), async (req, res) => {
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
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'approve', entity: 'coi', entityId: coi.id, ipAddress: req.ip });

    res.json(updated);
  } catch (err) {
    console.error('Approve COI error:', err);
    res.status(500).json({ error: 'Failed to approve COI' });
  }
});

// DELETE /api/cois/:id
router.delete('/:id', authenticate, authorize('ADMIN', 'MEMBER'), async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
      include: { vendor: true },
    });

    if (!coi) {
      return res.status(404).json({ error: 'COI not found' });
    }

    // Delete file from Spaces
    if (coi.pdfPath) {
      await deleteFile(coi.pdfPath).catch(err => console.error('[Storage] Delete failed:', err.message));
    }

    await prisma.coi.delete({
      where: { id: req.params.id },
    });

    await updateVendorStatus(prisma, coi.vendorId, coi.orgId);
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'delete', entity: 'coi', entityId: req.params.id, ipAddress: req.ip });

    res.json({ message: 'COI deleted' });
  } catch (err) {
    console.error('Delete COI error:', err);
    res.status(500).json({ error: 'Failed to delete COI' });
  }
});

// POST /api/cois/:id/reject
router.post('/:id/reject', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), async (req, res) => {
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
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'reject', entity: 'coi', entityId: coi.id, details: { reason }, ipAddress: req.ip });

    // Send rejection notification
    const { sendRejectionEmail } = require('../services/email');
    const portalUrl = `${process.env.APP_URL}/portal/${coi.vendor.uploadToken}`;
    const cc = coi.vendor.additionalEmails?.length > 0 ? coi.vendor.additionalEmails : undefined;
    await sendRejectionEmail(coi.vendor.email, coi.vendor.name, reason, portalUrl, cc).catch(console.error);

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
