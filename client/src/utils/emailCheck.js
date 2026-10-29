// Same rules as server/src/utils/emailAddress.js. Kept here so the form can
// show the message before the request leaves the browser.

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function emailFieldError(value) {
  const raw = value == null ? '' : String(value);
  if (!raw.trim()) return 'Email is required';

  const email = normalizeEmail(raw);
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/.test(email)) {
    return 'Enter a valid email address';
  }

  const [local, domain] = parts;
  if (local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) {
    return 'Enter a valid email address';
  }
  if (!domain.includes('.')) {
    return 'Enter a full email address, like name@company.com';
  }
  if (
    !/^[a-z0-9.-]+$/i.test(domain)
    || domain.startsWith('.')
    || domain.endsWith('.')
    || domain.includes('..')
  ) {
    return 'Enter a valid email address';
  }
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (!/^[a-z]{2,}$/i.test(tld)) return 'Enter a valid email address';
  return null;
}
