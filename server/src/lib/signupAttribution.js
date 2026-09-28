// Untrusted marketing params from the signup request. Stored on Organization.
// Bad or empty values become null so signup still succeeds with no UTMs.

const UTM_FIELDS = [
  ['utm_source', 'utmSource'],
  ['utm_medium', 'utmMedium'],
  ['utm_campaign', 'utmCampaign'],
  ['utm_term', 'utmTerm'],
  ['utm_content', 'utmContent'],
];

const UTM_MAX_LENGTH = 128;

function sanitizeUtmValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  let text = String(value).normalize('NFKC');
  text = text.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ');
  text = text.replace(/[<>]/g, '');
  text = text.trim().replace(/\s+/g, ' ');
  if (!text) return null;

  const chars = Array.from(text);
  if (chars.length > UTM_MAX_LENGTH) text = chars.slice(0, UTM_MAX_LENGTH).join('');
  return text || null;
}

function signupAttributionFromBody(body) {
  const data = {};
  if (!body || typeof body !== 'object') return data;
  for (const [param, column] of UTM_FIELDS) {
    const clean = sanitizeUtmValue(body[param]);
    if (clean) data[column] = clean;
  }
  return data;
}

module.exports = {
  UTM_FIELDS,
  UTM_MAX_LENGTH,
  sanitizeUtmValue,
  signupAttributionFromBody,
};
