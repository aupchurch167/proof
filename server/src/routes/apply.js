const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { uploadFile } = require('../services/storage');
const { extractCoiData } = require('../services/coiExtractor');
const { checkCompliance, updateVendorStatus } = require('../services/compliance');
const { generateUploadToken } = require('../utils/tokens');
const { isValidTrade } = require('../constants/trades');

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

function findOrg(slugOrId, extra = {}) {
  return prisma.organization.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
    ...extra,
  });
}

// GET /api/apply/:slug — minimal public org info so the form can brand itself.
router.get('/:slug', async (req, res) => {
  try {
    const org = await findOrg(req.params.slug, {
      select: { id: true, name: true, slug: true },
    });
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json({ name: org.name, slug: org.slug || org.id });
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
      const org = await findOrg(req.params.slug, { include: { settings: true } });
      if (!org) return res.status(404).json({ error: 'Not found' });

      const { name, contactName, phone, email, trade, notes, address, city, state, zip } = req.body;
      if (!name || !email || !phone || !address) {
        return res.status(400).json({ error: 'Business name, email, phone, and address are required' });
      }

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

      let w9Path = null;
      const w9File = req.files?.w9?.[0];
      if (w9File) {
        const key = `${uuidv4()}${path.extname(w9File.originalname) || ''}`;
        w9Path = await uploadFile(w9File.buffer, key, w9File.mimetype, 'w9s');
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
          w9Path,
          uploadToken: undefined, // placeholder, replaced below with a signed JWT
        },
      });
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { uploadToken: generateUploadToken(vendor.id) },
      });

      const coiFile = req.files?.coi?.[0];
      if (coiFile) {
        const key = `${uuidv4()}${path.extname(coiFile.originalname) || ''}`;
        const pdfPath = await uploadFile(coiFile.buffer, key, coiFile.mimetype, 'cois');

        let extracted = null;
        if (coiFile.mimetype === 'application/pdf') {
          try { extracted = await extractCoiData(coiFile.buffer); }
          catch (e) { console.error('Apply COI extract failed:', e.message); }
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
        await updateVendorStatus(prisma, vendor.id, org.id);
      }

      res.status(201).json({ message: 'Application submitted', vendorId: vendor.id });
    } catch (err) {
      console.error('Apply error:', err);
      res.status(500).json({ error: 'Failed to submit application' });
    }
  }
);

module.exports = router;
