const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const notifications = await prisma.notificationLog.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { sentAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
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
