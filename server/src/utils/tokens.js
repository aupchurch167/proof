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

module.exports = { generateAccessToken, generateRefreshToken };
