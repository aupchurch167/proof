const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { generateAccessToken, generateRefreshToken } = require('../utils/tokens');
const { authenticate } = require('../middleware/auth');
const { validate, passwordSchema } = require('../utils/validation');
const { sendPasswordResetEmail, sendEmailVerificationEmail } = require('../services/email');
const { verifyGoogleIdToken, isGoogleConfigured } = require('../lib/google');

const router = express.Router();

// GET /api/auth/config — public client config (which providers are enabled)
router.get('/config', (req, res) => {
  res.json({ googleEnabled: isGoogleConfigured() });
});

// POST /api/auth/signup
router.post('/signup', validate('signup'), async (req, res) => {
  try {
    const { orgName, email, password, firstName, lastName, phone, address } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');

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
          emailVerifyToken,
        },
      });

      return { org, user };
    });

    const verifyUrl = `${process.env.APP_URL || 'https://app.proofcoi.com'}/verify-email?token=${emailVerifyToken}`;
    await sendEmailVerificationEmail(email, verifyUrl).catch(console.error);

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
        emailVerified: false,
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

    // Accounts with no password can't log in this way. Point Google users at the
    // Google button; everything else (e.g. a pending invite) stays generic.
    if (!user.passwordHash) {
      if (user.googleId) {
        return res.status(401).json({ error: 'This account uses Google sign-in. Please continue with Google.' });
      }
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
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google — sign in / sign up with a Google ID token
router.post('/google', async (req, res) => {
  try {
    const { credential, orgName } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    let profile;
    try {
      profile = await verifyGoogleIdToken(credential);
    } catch (err) {
      console.error('Google token verification failed:', err.message);
      return res.status(401).json({ error: 'Invalid Google credential' });
    }

    // Match an existing account by Google id first, then fall back to email so
    // users who originally signed up with a password can link Google.
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
      include: { organization: true },
    });

    if (user) {
      // Link the Google id (and mark verified) on first Google login for an
      // account that was created another way.
      if (!user.googleId || !user.emailVerified) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: user.googleId || profile.googleId,
            emailVerified: true,
            emailVerifyToken: null,
          },
          include: { organization: true },
        });
      }
    } else {
      // New user — provision an organization, mirroring the signup flow.
      const created = await prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: (orgName && orgName.trim())
              || `${profile.firstName} ${profile.lastName}`.trim()
              || profile.email,
            email: profile.email,
            settings: { create: {} },
          },
        });

        const newUser = await tx.user.create({
          data: {
            orgId: org.id,
            email: profile.email,
            googleId: profile.googleId,
            firstName: profile.firstName || 'User',
            lastName: profile.lastName || '',
            role: 'ADMIN',
            emailVerified: true,
          },
          include: { organization: true },
        });

        return newUser;
      });
      user = created;
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
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Google sign-in failed' });
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
      emailVerified: user.emailVerified,
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
      const pwResult = passwordSchema.safeParse(newPassword);
      if (!pwResult.success) {
        const message = pwResult.error.issues.map(e => e.message).join(', ');
        return res.status(400).json({ error: message });
      }
      // Users who signed up with Google have no password yet, so they can set
      // one without providing a current password. Everyone else must confirm it.
      if (user.passwordHash) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password required to set new password' });
        }
        const valid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: 'Current password is incorrect' });
        }
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

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Always return 200 to prevent email enumeration
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiry },
      });

      const resetUrl = `${process.env.APP_URL || 'https://app.proofcoi.com'}/reset-password?token=${resetToken}`;
      await sendPasswordResetEmail(user.email, resetUrl).catch(console.error);
    }

    res.json({ message: 'If that email exists, you will receive a reset link shortly.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    const pwResult = passwordSchema.safeParse(newPassword);
    if (!pwResult.success) {
      const message = pwResult.error.issues.map(e => e.message).join(', ');
      return res.status(400).json({ error: message });
    }

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null },
    });

    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// GET /api/auth/verify-email
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.emailVerified) {
      return res.json({ message: 'Email already verified' });
    }

    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyToken },
    });

    const verifyUrl = `${process.env.APP_URL || 'https://app.proofcoi.com'}/verify-email?token=${emailVerifyToken}`;
    await sendEmailVerificationEmail(user.email, verifyUrl);

    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

module.exports = router;
