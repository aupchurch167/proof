const crypto = require('crypto');

// API tokens look like `prf_live_<random>` / `prf_test_<random>`. The random
// part is 32 bytes of base64url entropy. We store only the SHA-256 hash of the
// full token; the raw value is shown to the operator once at creation time.

const TOKEN_BYTES = 32;
const PREFIX_LENGTH = 16; // enough to include `prf_live_` + a few chars for logs

function generateToken(env = 'live') {
  const random = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return `prf_${env}_${random}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// A short, non-secret identifier stored alongside the hash so tokens can be
// recognized in a UI or logs (e.g. "prf_live_9dGk...") without revealing them.
function tokenPrefix(token) {
  return token.slice(0, PREFIX_LENGTH);
}

module.exports = { generateToken, hashToken, tokenPrefix };
