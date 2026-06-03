const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { getSignedUrl } = require('../services/storage');

const router = express.Router();

// Inbound vendor replies are recorded in AuditLog with action 'vendor_reply'
// by /api/webhooks/resend-inbound. These routes expose them as a feed.

async function annotateWithVendor(orgId, rows) {
  const vendorIds = [...new Set(rows.map((r) => r.entityId).filter(Boolean))];
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds }, orgId },
    select: { id: true, name: true, email: true, deletedAt: true },
  });
  const byId = new Map(vendors.map((v) => [v.id, v]));

  return Promise.all(rows.map(async (r) => {
    const rawAttachments = Array.isArray(r.details?.attachments) ? r.details.attachments : [];
    const attachments = await Promise.all(rawAttachments.map(async (a) => {
      const url = a?.savedAs ? await getSignedUrl(a.savedAs).catch(() => null) : null;
      return {
        filename: a.filename || null,
        mimetype: a.mimetype || null,
        size: a.size || null,
        classified: a.classified || null,
        coiId: a.coiId || null,
        url,
        error: a.error || null,
      };
    }));

    return {
      id: r.id,
      vendorId: r.entityId,
      vendor: byId.get(r.entityId) || null,
      from: r.details?.from || null,
      subject: r.details?.subject || null,
      preview: r.details?.preview || '',
      receivedAt: r.details?.receivedAt || r.createdAt,
      createdAt: r.createdAt,
      attachments,
    };
  }));
}

// GET /api/replies — all vendor replies for the user's org, newest first.
router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows = await prisma.auditLog.findMany({
      where: { orgId: req.user.orgId, action: 'vendor_reply' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json(await annotateWithVendor(req.user.orgId, rows));
  } catch (err) {
    console.error('List replies error:', err);
    res.status(500).json({ error: 'Failed to list replies' });
  }
});

// GET /api/replies/vendor/:vendorId — replies for one vendor.
router.get('/vendor/:vendorId', authenticate, async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.vendorId, orgId: req.user.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const rows = await prisma.auditLog.findMany({
      where: { orgId: req.user.orgId, action: 'vendor_reply', entityId: vendor.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(await annotateWithVendor(req.user.orgId, rows));
  } catch (err) {
    console.error('Vendor replies error:', err);
    res.status(500).json({ error: 'Failed to list vendor replies' });
  }
});

module.exports = router;
