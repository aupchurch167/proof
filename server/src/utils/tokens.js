const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SIGN_OPTS = { algorithm: 'HS256' };
const VERIFY_OPTS = { algorithms: ['HS256'] };

function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, orgId: user.orgId, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m', ...SIGN_OPTS }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, orgId: user.orgId, jti: crypto.randomBytes(16).toString('hex') },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d', ...SIGN_OPTS }
  );
}

function generateUploadToken(vendorId, expiresIn = '7d') {
  return jwt.sign(
    { vendorId, purpose: 'upload' },
    process.env.JWT_SECRET,
    { expiresIn, ...SIGN_OPTS }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTS);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET, VERIFY_OPTS);
}

function verifyUploadToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTS);
  if (payload.purpose !== 'upload') {
    throw new Error('Invalid token purpose');
  }
  return payload;
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateUploadToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyUploadToken,
};
