const prisma = require('../lib/prisma');
const { verifyAccessToken } = require('../utils/tokens');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

async function requireVerified(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { emailVerified: true },
    });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Email verification required',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

function authenticateVerified(req, res, next) {
  authenticate(req, res, (err) => {
    if (err) return next(err);
    if (res.headersSent) return;
    requireVerified(req, res, next);
  });
}

module.exports = { authenticate, authorize, requireVerified, authenticateVerified };
