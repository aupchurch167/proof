// Shared response conventions for the versioned public API (/api/v1).
//
// Every consumer branches on these shapes, so they live in one place:
//   single:    { "data": { ... } }
//   list:      { "data": [ ... ], "nextCursor": "...|null", "hasMore": bool }
//   error:     { "error": { "code": "...", "message": "...", "details": {} } }

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function data(res, payload, status = 200) {
  return res.status(status).json({ data: payload });
}

function paginated(res, items, nextCursor, hasMore) {
  return res.json({ data: items, nextCursor: nextCursor || null, hasMore: Boolean(hasMore) });
}

function error(res, status, code, message, details = {}) {
  return res.status(status).json({ error: { code, message, details } });
}

// Common error shorthands so status codes stay consistent across routes.
const errors = {
  unauthorized: (res, message = 'Missing or invalid token') => error(res, 401, 'unauthorized', message),
  forbidden: (res, message = 'Token is not authorized for this organization') => error(res, 403, 'forbidden', message),
  notFound: (res, code = 'not_found', message = 'Resource not found') => error(res, 404, code, message),
  validation: (res, message, details = {}) => error(res, 422, 'validation_error', message, details),
  conflict: (res, code, message, details = {}) => error(res, 409, code, message, details),
  server: (res, message = 'Internal server error') => error(res, 500, 'internal_error', message),
};

// Clamp a `limit` query param into [1, MAX_LIMIT], defaulting when absent/invalid.
function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Opaque cursor = base64url(JSON). Callers treat it as a blob; we keep the
// encoding internal so the keyset shape can change without breaking consumers.
function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  data,
  paginated,
  error,
  errors,
  parseLimit,
  encodeCursor,
  decodeCursor,
};
