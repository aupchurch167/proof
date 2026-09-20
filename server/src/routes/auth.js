const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { validate, passwordSchema } = require('../utils/validation');
const { sendPasswordResetEmail, sendEmailVerificationEmail } = require('../services/email');
const { verifyGoogleIdToken, isGoogleConfigured } = require('../lib/google');
const {
  issueTokenPair,
  rotateRefreshToken,
  revokeFamilyForRefreshToken,
  revokeAllForUser,
} = require('../lib/sessions');
const { hashToken } = require('../lib/apiTokens');
const { verifyAccessToken } = require('../utils/tokens');

const router = express.Router();

const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const SIGNUP_MESSAGE = 'If this address is new, we sent a verification email.';

function slugForOrg(name) {
  const base = String(name || 'org')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'org';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function publicUser(user, orgName) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    orgId: user.orgId,
    orgName,
    emailVerified: user.emailVerified,
  };
}

async function findInviteUser(rawToken) {
  const tokenHash = hashToken(rawToken);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { inviteTokenHash: tokenHash },
        { inviteToken: rawToken },
      ],
    },
    include: { organization: true },
  });
  if (!user) return null;
  if (!user.inviteTokenExpiry || user.inviteTokenExpiry < new Date()) return null;
  return user;
}

// GET /api/auth/config — public client config (which providers are enabled)
router.get('/config', (req, res) => {
  res.json({ googleEnabled: isGoogleConfigured() });
});

// POST /api/auth/signup
router.post('/signup', validate('signup'), async (req, res) => {
  try {
    const { orgName, email, password, firstName, lastName, phone, address } = req.body;

    // Hash first so existing-vs-new timing is closer (A1-06).
    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(201).json({ message: SIGNUP_MESSAGE });
    }

    const emailVerifyToken = crypto.randomBytes(32).toString('hex');

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          email,
          phone: phone || null,
          address: address || null,
          slug: slugForOrg(orgName),
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

    const tokens = await issueTokenPair(result.user);

    res.status(201).json({
      message: SIGNUP_MESSAGE,
      ...tokens,
      user: publicUser({ ...result.user, emailVerified: false }, result.org.name),
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

    const tokens = await issueTokenPair(user);

    res.json({
      ...tokens,
      user: publicUser(user, user.organization.name),
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

    const profileEmail = String(profile.email || '').trim().toLowerCase();

    let user = await prisma.user.findFirst({
      where: { googleId: profile.googleId },
      include: { organization: true },
    });

    if (user) {
      // googleId is not enough after an email change: Google must still own
      // the address currently on the row (A1-03).
      if (String(user.email || '').trim().toLowerCase() !== profileEmail) {
        return res.status(409).json({
          error: 'This Google account is no longer linked to this email. Sign in with your password or verify the new address.',
        });
      }
      if (!user.emailVerified) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true, emailVerifyToken: null },
          include: { organization: true },
        });
      }
    } else {
      const byEmail = await prisma.user.findUnique({
        where: { email: profile.email },
        include: { organization: true },
      });
      if (byEmail) {
        // Email-link only when the inbox is already verified. A leftover
        // googleId on an unverified row must not auto-verify.
        if (!byEmail.emailVerified) {
          return res.status(409).json({
            error: 'An account with this email already exists. Verify your email or sign in with your password.',
          });
        }
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: byEmail.googleId || profile.googleId,
            emailVerified: true,
            emailVerifyToken: null,
          },
          include: { organization: true },
        });
      }
    }

    if (!user) {
      const created = await prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: (orgName && orgName.trim())
              || `${profile.firstName} ${profile.lastName}`.trim()
              || profile.email,
            email: profile.email,
            slug: slugForOrg(orgName || profile.email),
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

    const tokens = await issueTokenPair(user);

    res.json({
      ...tokens,
      user: publicUser(user, user.organization.name),
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

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    res.json(rotated);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout — revoke the refresh family (A1-01)
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      await revokeFamilyForRefreshToken(refreshToken);
    } else {
      const header = req.headers.authorization;
      if (header && header.startsWith('Bearer ')) {
        try {
          const payload = verifyAccessToken(header.split(' ')[1]);
          if (payload?.id) await revokeAllForUser(payload.id);
        } catch (err) {
          // Access token may already be expired; still succeed locally.
        }
      }
    }
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Failed to log out' });
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

    res.json(publicUser(user, user.organization.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/accept-invite — accept an invitation and set up account
router.post('/accept-invite', validate('acceptInvite'), async (req, res) => {
  try {
    const { token, firstName, lastName, password } = req.body;

    const user = await findInviteUser(token);
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
        inviteTokenHash: null,
        inviteTokenExpiry: null,
        emailVerified: true,
        emailVerifyToken: null,
      },
      include: { organization: true },
    });

    const tokens = await issueTokenPair(updated);

    res.json({
      ...tokens,
      user: publicUser(updated, updated.organization.name),
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

    const user = await findInviteUser(token);
    if (!user) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }

    res.json({ email: user.email, orgName: user.organization.name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get invite info' });
  }
});

// PUT /api/auth/me — update own profile
router.put('/me', authenticate, validate('updateProfile'), async (req, res) => {
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
      if (!user.passwordHash) {
        return res.status(400).json({ error: 'Set a password before changing email' });
      }
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password required to change email' });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      data.email = email;
      data.emailVerified = false;
      data.emailVerifyToken = crypto.randomBytes(32).toString('hex');
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

    if (data.emailVerifyToken) {
      const verifyUrl = `${process.env.APP_URL || 'https://app.proofcoi.com'}/verify-email?token=${data.emailVerifyToken}`;
      await sendEmailVerificationEmail(updated.email, verifyUrl).catch(console.error);
    }

    res.json(publicUser(updated, updated.organization.name));
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
    await revokeAllForUser(user.id);

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
