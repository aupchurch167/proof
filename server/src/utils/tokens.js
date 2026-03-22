const jwt = require('jsonwebtoken');

function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, orgId: user.orgId, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, orgId: user.orgId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

function generateUploadToken(vendorId) {
  return jwt.sign(
    { vendorId, purpose: 'upload' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyUploadToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.purpose !== 'upload') {
    throw new Error('Invalid token purpose');
  }
  return payload;
}

module.exports = { generateAccessToken, generateRefreshToken, generateUploadToken, verifyUploadToken };
