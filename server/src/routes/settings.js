const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateVerified: authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../utils/validation');

const router = express.Router();

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
router.put('/', authenticate, authorize('ADMIN'), validate('updateSettings'), async (req, res) => {
  try {
    const {
      minGeneralLiability,
      minWorkersComp,
      minUmbrella,
      minAutomobile,
      reminderDaysBefore,
      chaseDaysAfterRequest,
      notifyOnUpload,
      notifyOnExpiration,
      chaseNonResponders,
    } = req.body;

    // Both day lists are free-form JSON columns — normalize before storing so
    // the cron jobs never have to defend against strings or duplicates.
    const dayList = (value) => [
      ...new Set(
        value
          .map((n) => (typeof n === 'string' ? Number(n.trim()) : Number(n)))
          .filter((n) => Number.isFinite(n))
          .map((n) => Math.trunc(n))
      ),
    ];

    if (reminderDaysBefore !== undefined && !Array.isArray(reminderDaysBefore)) {
      return res.status(400).json({ error: 'reminderDaysBefore must be an array of numbers' });
    }
    if (chaseDaysAfterRequest !== undefined) {
      if (!Array.isArray(chaseDaysAfterRequest)) {
        return res.status(400).json({ error: 'chaseDaysAfterRequest must be an array of numbers' });
      }
      if (dayList(chaseDaysAfterRequest).some((d) => d <= 0)) {
        return res.status(400).json({ error: 'chaseDaysAfterRequest must contain positive day offsets' });
      }
    }

    const settings = await prisma.organizationSettings.update({
      where: { orgId: req.user.orgId },
      data: {
        ...(minGeneralLiability !== undefined && { minGeneralLiability }),
        ...(minWorkersComp !== undefined && { minWorkersComp }),
        ...(minUmbrella !== undefined && { minUmbrella }),
        ...(minAutomobile !== undefined && { minAutomobile }),
        ...(reminderDaysBefore !== undefined && { reminderDaysBefore: dayList(reminderDaysBefore) }),
        ...(chaseDaysAfterRequest !== undefined && {
          chaseDaysAfterRequest: dayList(chaseDaysAfterRequest).sort((a, b) => a - b),
        }),
        ...(notifyOnUpload !== undefined && { notifyOnUpload }),
        ...(notifyOnExpiration !== undefined && { notifyOnExpiration }),
        ...(chaseNonResponders !== undefined && { chaseNonResponders }),
      },
    });

    res.json(settings);
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
