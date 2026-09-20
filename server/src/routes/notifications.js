const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateVerified: authenticate } = require('../middleware/auth');
const { parseLimit, parseOffset } = require('../http/respond');

const router = express.Router();

// GET /api/notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const notifications = await prisma.notificationLog.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { sentAt: 'desc' },
      take: parseLimit(req.query.limit),
      skip: parseOffset(req.query.offset),
      include: {
        vendor: { select: { id: true, name: true } },
        coi: { select: { id: true, status: true } },
      },
    });

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

module.exports = router;
