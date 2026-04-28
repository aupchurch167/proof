const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { sendInviteEmail } = require('../services/email');
const { logAudit } = require('../services/audit');

const router = express.Router();

// GET /api/users — ADMIN only
router.get('/', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { orgId: req.user.orgId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, inviteToken: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/users/invite — ADMIN only, sends email invite
router.post('/invite', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const validRoles = ['ADMIN', 'MEMBER'];
    const assignRole = validRoles.includes(role) ? role : 'MEMBER';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const inviteToken = uuidv4();

    const user = await prisma.user.create({
      data: {
        orgId: req.user.orgId,
        email,
        passwordHash: '',
        firstName: '',
        lastName: '',
        role: assignRole,
        inviteToken,
      },
      select: { id: true, email: true, role: true, inviteToken: true, createdAt: true },
    });

    // Fetch org name for the email
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: { name: true },
    });

    const inviteUrl = `${process.env.APP_URL}/accept-invite?token=${inviteToken}`;
    await sendInviteEmail(email, org?.name || 'your organization', inviteUrl).catch(console.error);

    res.status(201).json(user);
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// PUT /api/users/:id/role — ADMIN only
router.put('/:id/role', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['ADMIN', 'MEMBER'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN or MEMBER.' });
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent the last admin from demoting themselves
    if (targetUser.id === req.user.id && role !== 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { orgId: req.user.orgId, role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'change_role', entity: 'user', entityId: req.params.id, details: { newRole: role }, ipAddress: req.ip });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/users/:id — ADMIN only, remove user from org
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const targetUser = await prisma.user.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting yourself
    if (targetUser.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    // Prevent removing the last admin
    if (targetUser.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { orgId: req.user.orgId, role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'remove', entity: 'user', entityId: req.params.id, details: { email: targetUser.email }, ipAddress: req.ip });

    res.json({ message: 'User removed' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

module.exports = router;
