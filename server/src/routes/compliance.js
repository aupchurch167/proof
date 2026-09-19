const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { buildComplianceOverview } = require('../services/complianceOverview');
const { logAudit } = require('../services/audit');

const router = express.Router();

// GET /api/compliance/overview — the single "who do I chase today" view.
router.get('/overview', authenticate, async (req, res) => {
  try {
    const parsed = parseInt(req.query.ignoredAfterDays, 10);
    const ignoredAfterDays = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;

    const overview = await buildComplianceOverview(prisma, req.user.orgId, {
      ...(ignoredAfterDays !== undefined && { ignoredAfterDays }),
    });

    res.json(overview);
  } catch (err) {
    console.error('Compliance overview error:', err);
    res.status(500).json({ error: 'Failed to build compliance overview' });
  }
});

// POST /api/compliance/vendors/:id/contacted — ops reached the vendor by phone
// or in person. Drops them out of the ignored-request queue until the next
// upload request goes out, without pretending an email was sent.
router.post('/vendors/:id/contacted', authenticate, authorize('ADMIN', 'MEMBER', 'REVIEWER'), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId, deletedAt: null },
      select: { id: true, name: true, email: true },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;

    const log = await prisma.notificationLog.create({
      data: {
        orgId: req.user.orgId,
        vendorId: vendor.id,
        type: 'MANUAL_CONTACT',
        recipientEmail: vendor.email,
        status: 'SENT',
        meta: { by: req.user.id, ...(note && { note }) },
      },
    });

    logAudit({
      orgId: req.user.orgId,
      userId: req.user.id,
      action: 'mark_contacted',
      entity: 'vendor',
      entityId: vendor.id,
      details: { vendorName: vendor.name, ...(note && { note }) },
      ipAddress: req.ip,
    });

    res.json({ message: 'Vendor marked as contacted', contactedAt: log.sentAt });
  } catch (err) {
    console.error('Mark contacted error:', err);
    res.status(500).json({ error: 'Failed to mark vendor as contacted' });
  }
});

module.exports = router;
