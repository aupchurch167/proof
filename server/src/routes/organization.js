const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, authorize } = require('../middleware/auth');

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

module.exports = router;
