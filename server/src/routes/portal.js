const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { extractCoiData } = require('../services/coiExtractor');
const { checkCompliance } = require('../services/compliance');
const { sendUploadNotificationEmail } = require('../services/email');

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

// GET /api/portal/:uploadToken
router.get('/:uploadToken', async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { uploadToken: req.params.uploadToken },
      select: { id: true, name: true, email: true, phone: true, address: true },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Invalid upload link' });
    }

    res.json(vendor);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load portal' });
  }
});

// PUT /api/portal/:uploadToken/info
router.put('/:uploadToken/info', async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;

    const vendor = await prisma.vendor.findUnique({
      where: { uploadToken: req.params.uploadToken },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Invalid upload link' });
    }

    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
      },
      select: { id: true, name: true, email: true, phone: true, address: true },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update info' });
  }
});

// POST /api/portal/:uploadToken/upload
router.post('/:uploadToken/upload', upload.single('pdf'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { uploadToken: req.params.uploadToken },
      include: { organization: { include: { settings: true } } },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Invalid upload link' });
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
});

module.exports = router;
