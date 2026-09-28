// Captured from /signup (and /login, if a redirect lands there) and sent with
// password signup and Google signup. sessionStorage keeps them across a reload
// or a same-tab redirect. The server sanitizes again before storing.

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const STORAGE_KEY = 'proof.signupUtms';
const MAX_LEN = 128;

function sanitize(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return Array.from(text).slice(0, MAX_LEN).join('');
}

function readStored() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    const out = {};
    for (const key of UTM_KEYS) {
      const clean = sanitize(parsed?.[key]);
      if (clean) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

export function rememberSignupUtms(searchParams) {
  const next = readStored();
  let changed = false;
  for (const key of UTM_KEYS) {
    const clean = sanitize(searchParams?.get?.(key) ?? '');
    if (clean && next[key] !== clean) {
      next[key] = clean;
      changed = true;
    }
  }
  if (changed) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode can reject storage. The query string still carries them.
    }
  }
  return next;
}

export function readSignupUtms() {
  return readStored();
}

export function signupUtmSearch() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(readStored())) params.set(key, value);
  const search = params.toString();
  return search ? `?${search}` : '';
}

export function clearSignupUtms() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
