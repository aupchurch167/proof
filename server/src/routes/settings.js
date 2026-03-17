const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/settings
router.get('/', authenticate, async (req, res) => {
  try {
    const settings = await prisma.organizationSettings.findUnique({
      where: { orgId: req.user.orgId },
    });

    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT /api/settings
router.put('/', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const {
      minGeneralLiability,
      minWorkersComp,
      minUmbrella,
      minAutomobile,
      reminderDaysBefore,
      notifyOnUpload,
      notifyOnExpiration,
    } = req.body;

    const settings = await prisma.organizationSettings.update({
      where: { orgId: req.user.orgId },
      data: {
        ...(minGeneralLiability !== undefined && { minGeneralLiability }),
        ...(minWorkersComp !== undefined && { minWorkersComp }),
        ...(minUmbrella !== undefined && { minUmbrella }),
        ...(minAutomobile !== undefined && { minAutomobile }),
        ...(reminderDaysBefore !== undefined && { reminderDaysBefore }),
        ...(notifyOnUpload !== undefined && { notifyOnUpload }),
        ...(notifyOnExpiration !== undefined && { notifyOnExpiration }),
      },
    });

    res.json(settings);
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
