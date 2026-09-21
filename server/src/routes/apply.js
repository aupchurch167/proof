const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { uploadFile } = require('../services/storage');
const { extractCoiData, assertExtractAllowed } = require('../services/coiExtractor');
const { isExtractLimitError } = require('../lib/extractErrors');
const { hasPdfMagic } = require('../utils/uploadFilters');
const { schemas, parseSchema } = require('../utils/validation');
const { checkCompliance, updateVendorStatus } = require('../services/compliance');
const { generateUploadToken } = require('../utils/tokens');
const { isValidTrade } = require('../constants/trades');
const { evaluatePlanLimit } = require('../middleware/planLimits');
const { isVendorEmailConflict } = require('../lib/prismaErrors');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF or image files are allowed'));
  },
});

// Public endpoint, so use a stricter rate limit than the general /api one.
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions, please try again later' },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findOrgBySlug(slug, extra = {}) {
  if (!slug || UUID_RE.test(slug)) return null;
  return prisma.organization.findFirst({
    where: { slug },
    ...extra,
  });
}

// GET /api/apply/:slug — minimal public org info so the form can brand itself.
router.get('/:slug', async (req, res) => {
  try {
    const org = await findOrgBySlug(req.params.slug, {
      select: { id: true, name: true, slug: true },
    });
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json({ name: org.name, slug: org.slug });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load' });
  }
});

// POST /api/apply/:slug — vendor application submission.
router.post(
  '/:slug',
  applyLimiter,
  upload.fields([{ name: 'w9', maxCount: 1 }, { name: 'coi', maxCount: 1 }]),
  async (req, res) => {
    try {
      const org = await findOrgBySlug(req.params.slug, { include: { settings: true } });
      if (!org) return res.status(404).json({ error: 'Not found' });

      // A10-02: public apply must not collect W-9 / TIN until a DPA path exists.
      // Keep the multer field so we can reject it with a clear 400. Existing
      // stored W-9s are left in place.
      if (req.files?.w9?.length || Object.prototype.hasOwnProperty.call(req.body || {}, 'w9')) {
        return res.status(400).json({
          error: 'W-9 uploads are not accepted on the public apply form until a DPA is in place.',
          code: 'W9_NOT_ACCEPTED',
        });
      }

      const limit = await evaluatePlanLimit(org.id, 'vendor');
      if (!limit.ok) {
        return res.status(403).json({
          ...limit.body,
          error: 'This organization has reached its vendor limit. Please contact them to resolve this.',
        });
      }

      const parsed = parseSchema(schemas.applyVendor, req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error });
      }
      const { name, contactName, phone, email, trade, notes, address, city, state, zip } = parsed.data;

      if (trade && !isValidTrade(trade)) {
        return res.status(400).json({ error: 'Invalid trade value' });
      }

      const composedAddress = [
        address,
        [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      ].filter(Boolean).join(', ');

      const existing = await prisma.vendor.findFirst({
        where: { orgId: org.id, email, deletedAt: null },
      });
      if (existing) {
        return res.status(409).json({ error: 'A vendor with this email already exists for this organization' });
      }

      const coiFile = req.files?.coi?.[0];
      if (coiFile && coiFile.mimetype === 'application/pdf') {
        if (!hasPdfMagic(coiFile.buffer)) {
          return res.status(400).json({ error: 'File is not a valid PDF' });
        }
        try {
          await assertExtractAllowed(org.id, coiFile.buffer.length);
        } catch (err) {
          if (isExtractLimitError(err)) {
            return res.status(err.status).json({ error: err.message, code: err.code });
          }
          throw err;
        }
      }

      const vendor = await prisma.vendor.create({
        data: {
          orgId: org.id,
          name,
          contactName: contactName || null,
          email,
          phone,
          address: composedAddress,
          trade: trade || null,
          notes: notes || null,
          uploadToken: undefined, // placeholder, replaced below with a signed JWT
        },
      });
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { uploadToken: generateUploadToken(vendor.id) },
      });

      if (coiFile) {
        const key = `${uuidv4()}${path.extname(coiFile.originalname) || ''}`;
        const pdfPath = await uploadFile(coiFile.buffer, key, coiFile.mimetype, 'cois');

        let extracted = null;
        if (coiFile.mimetype === 'application/pdf') {
          try { extracted = await extractCoiData(coiFile.buffer, { orgId: org.id }); }
          catch (e) {
            if (isExtractLimitError(e)) {
              return res.status(e.status).json({ error: e.message, code: e.code });
            }
            console.error('Apply COI extract failed:', e.message);
          }
        }
        const complianceFlags = (org.settings && extracted)
          ? checkCompliance(extracted, org.settings, org.name) : null;

        await prisma.coi.create({
          data: {
            vendorId: vendor.id,
            orgId: org.id,
            pdfPath,
            status: 'PENDING_REVIEW',
            aiExtractedData: extracted,
            complianceFlags,
            glPolicyNumber: extracted?.glPolicyNumber || null,
            glCoverageAmount: extracted?.glCoverageAmount || null,
            glExpirationDate: extracted?.glExpirationDate ? new Date(extracted.glExpirationDate) : null,
            wcPolicyNumber: extracted?.wcPolicyNumber || null,
            wcCoverageAmount: extracted?.wcCoverageAmount || null,
            wcExpirationDate: extracted?.wcExpirationDate ? new Date(extracted.wcExpirationDate) : null,
            umbPolicyNumber: extracted?.umbPolicyNumber || null,
            umbCoverageAmount: extracted?.umbCoverageAmount || null,
            umbExpirationDate: extracted?.umbExpirationDate ? new Date(extracted.umbExpirationDate) : null,
            autoPolicyNumber: extracted?.autoPolicyNumber || null,
            autoCoverageAmount: extracted?.autoCoverageAmount || null,
            autoExpirationDate: extracted?.autoExpirationDate ? new Date(extracted.autoExpirationDate) : null,
            coverageType: extracted?.coverageType || null,
            agentName: extracted?.agentName || null,
            agentEmail: extracted?.agentEmail || null,
            agentPhone: extracted?.agentPhone || null,
            insuranceCompany: extracted?.insuranceCompany || null,
            certificateHolderName: extracted?.certificateHolderName || null,
            certificateHolderAddress: extracted?.certificateHolderAddress || null,
          },
        });
        // Auto-add agent email to vendor's additional emails
        if (extracted?.agentEmail) {
          await prisma.vendor.update({
            where: { id: vendor.id },
            data: { additionalEmails: { push: extracted.agentEmail.trim() } },
          });
        }

        await updateVendorStatus(prisma, vendor.id, org.id);
      }

      res.status(201).json({ message: 'Application submitted', vendorId: vendor.id });
    } catch (err) {
      if (isVendorEmailConflict(err)) {
        return res.status(409).json({ error: 'A vendor with this email already exists for this organization' });
      }
      console.error('Apply error:', err);
      res.status(500).json({ error: 'Failed to submit application' });
    }
  }
);

module.exports = router;
