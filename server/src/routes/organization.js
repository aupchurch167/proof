const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateVerified: authenticate, authorize } = require('../middleware/auth');
const { getPlanLimits, getPlanLabel } = require('../config/plans');
const { generateUploadToken } = require('../utils/tokens');

const router = express.Router();

// GET /api/organization
router.get('/', authenticate, async (req, res) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
    });

    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(org);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get organization' });
  }
});

// PUT /api/organization
router.put('/', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { name, email, phone, address, additionalInsuredNote } = req.body;

    const data = {};
    if (name) data.name = name;
    if (email) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (address !== undefined) data.address = address;
    if (additionalInsuredNote !== undefined) data.additionalInsuredNote = additionalInsuredNote;

    const updated = await prisma.organization.update({
      where: { id: req.user.orgId },
      data,
    });

    res.json(updated);
  } catch (err) {
    console.error('Update org error:', err);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// GET /api/organization/usage — plan meter for the sidebar. ADMIN-only mint of
// a short-lived portal preview JWT (never the stored uploadToken).
router.get('/usage', authenticate, async (req, res) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: { plan: true },
    });
    const plan = org?.plan || 'FREE';
    const limits = getPlanLimits(plan);

    const [vendorCount, coiCount, sampleVendor] = await Promise.all([
      prisma.vendor.count({ where: { orgId: req.user.orgId, deletedAt: null } }),
      prisma.coi.count({ where: { orgId: req.user.orgId, deletedAt: null } }),
      req.user.role === 'ADMIN'
        ? prisma.vendor.findFirst({
          where: { orgId: req.user.orgId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
        : Promise.resolve(null),
    ]);

    // Infinity doesn't survive JSON, so an unlimited plan reports a null limit
    // and a 0% meter.
    const meter = (used, limit) => ({
      used,
      limit: limit === Infinity ? null : limit,
      percent: limit === Infinity ? 0 : Math.min(100, Math.round((used / limit) * 100)),
    });

    const body = {
      plan,
      planLabel: getPlanLabel(plan),
      vendors: meter(vendorCount, limits.maxVendors),
      cois: meter(coiCount, limits.maxCois),
    };
    if (req.user.role === 'ADMIN' && sampleVendor) {
      body.portalPreviewToken = generateUploadToken(sampleVendor.id, '15m');
    }

    res.json(body);
  } catch (err) {
    console.error('Usage error:', err);
    res.status(500).json({ error: 'Failed to load plan usage' });
  }
});

module.exports = router;
