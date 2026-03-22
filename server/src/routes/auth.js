const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { generateAccessToken, generateRefreshToken } = require('../utils/tokens');
const { authenticate } = require('../middleware/auth');
const { validate, passwordSchema } = require('../utils/validation');

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/auth/signup
router.post('/signup', validate('signup'), async (req, res) => {
  try {
    const { orgName, email, password, firstName, lastName, phone, address } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          email,
          phone: phone || null,
          address: address || null,
          settings: {
            create: {},
          },
        },
      });

      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email,
          passwordHash,
          firstName,
          lastName,
          role: 'ADMIN',
        },
      });

      return { org, user };
    });

    const accessToken = generateAccessToken(result.user);
    const refreshToken = generateRefreshToken(result.user);

    res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
        orgId: result.user.orgId,
        orgName: result.org.name,
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// POST /api/auth/login
router.post('/login', validate('login'), async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        orgId: user.orgId,
        orgName: user.organization.name,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.id } });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { organization: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      orgId: user.orgId,
      orgName: user.organization.name,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/accept-invite — accept an invitation and set up account
router.post('/accept-invite', validate('acceptInvite'), async (req, res) => {
  try {
    const { token, firstName, lastName, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { inviteToken: token },
      include: { organization: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName,
        lastName,
        passwordHash,
        inviteToken: null,
      },
      include: { organization: true },
    });

    const accessToken = generateAccessToken(updated);
    const refreshToken = generateRefreshToken(updated);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
        orgId: updated.orgId,
        orgName: updated.organization.name,
      },
    });
  } catch (err) {
    console.error('Accept invite error:', err);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// GET /api/auth/invite-info — get info about an invite token
router.get('/invite-info', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const user = await prisma.user.findUnique({
      where: { inviteToken: token },
      include: { organization: { select: { name: true } } },
    });

    if (!user) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }

    res.json({ email: user.email, orgName: user.organization.name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get invite info' });
  }
});

// PUT /api/auth/me — update own profile
router.put('/me', authenticate, async (req, res) => {
  try {
    const { firstName, lastName, email, currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const data = {};
    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;

    if (email && email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      data.email = email;
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password required to set new password' });
      }
      const pwResult = passwordSchema.safeParse(newPassword);
      if (!pwResult.success) {
        const message = pwResult.error.issues.map(e => e.message).join(', ');
        return res.status(400).json({ error: message });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      data.passwordHash = await bcrypt.hash(newPassword, 12);
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      include: { organization: true },
    });

    res.json({
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      role: updated.role,
      orgId: updated.orgId,
      orgName: updated.organization.name,
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
