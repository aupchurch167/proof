const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/users
router.get('/', authenticate, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { orgId: req.user.orgId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/users/invite
router.post('/invite', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { email, firstName, lastName, role, password } = req.body;

    if (!email || !firstName || !lastName || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        orgId: req.user.orgId,
        email,
        passwordHash,
        firstName,
        lastName,
        role: role || 'VIEWER',
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    res.status(201).json(user);
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// PUT /api/users/:id/role
router.put('/:id/role', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['ADMIN', 'REVIEWER', 'VIEWER'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await prisma.user.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

module.exports = router;
