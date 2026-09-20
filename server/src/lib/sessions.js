const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma = require('./prisma');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/tokens');

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueTokenPair(user, { family } = {}) {
  const fam = family || uuidv4();
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      family: fam,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { accessToken, refreshToken };
}

async function findUsableSession(rawToken) {
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { tokenHash } });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt < new Date()) return session;
  return session;
}

async function rotateRefreshToken(rawToken) {
  let payload;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch (err) {
    return null;
  }

  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { tokenHash } });
  if (!session || session.userId !== payload.id) return null;

  if (session.revokedAt || session.expiresAt < new Date()) {
    // Reuse of a revoked/expired token — kill the family (theft / replay).
    await prisma.session.updateMany({
      where: { family: session.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return null;

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  return issueTokenPair(user, { family: session.family });
}

async function revokeFamilyForRefreshToken(rawToken) {
  if (!rawToken) return;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!session) return;
  await prisma.session.updateMany({
    where: { family: session.family, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeAllForUser(userId) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  hashToken,
  issueTokenPair,
  findUsableSession,
  rotateRefreshToken,
  revokeFamilyForRefreshToken,
  revokeAllForUser,
};
