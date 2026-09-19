const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * Verify a Google ID token (the credential returned by Google Identity Services)
 * and return the normalized profile. Throws if the token is invalid, expired, or
 * was not minted for this app's client id.
 */
async function verifyGoogleIdToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Google sign-in is not configured');
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('Google token missing email');
  }
  if (!payload.email_verified) {
    throw new Error('Google account email is not verified');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    firstName: payload.given_name || '',
    lastName: payload.family_name || '',
  };
}

function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID);
}

module.exports = { verifyGoogleIdToken, isGoogleConfigured };
