// Same rules as server/src/utils/vendorContact.js so the form can show the
// message before the request leaves the browser.

const PHONE_ERROR = 'Enter a phone number using digits, like (555) 555-0100';
const ADDRESS_ERROR = 'Enter a street address (at least 5 characters)';

const PHONE_PATTERN = /^\+?[\d\s().-]+(?:\s*(?:ext\.?|extension|x|#)\s*\d{1,6})?$/i;

export function phoneFieldError(value, { required = false } = {}) {
  if (value == null) return required ? 'Phone is required' : null;
  const raw = String(value).trim();
  if (!raw) return required ? 'Phone is required' : null;
  if (!PHONE_PATTERN.test(raw)) return PHONE_ERROR;

  const main = raw.split(/\s*(?:ext\.?|extension|x|#)\s*/i)[0];
  const digits = main.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return PHONE_ERROR;
  return null;
}

export function addressFieldError(value, { required = false } = {}) {
  if (value == null) return required ? 'Address is required' : null;
  const raw = String(value).trim();
  if (!raw) return required ? 'Address is required' : null;
  if (raw.length < 5 || raw.length > 300) return ADDRESS_ERROR;
  if (!/[A-Za-z]/.test(raw)) return ADDRESS_ERROR;
  if (/[\u0000-\u001F]/.test(raw)) return ADDRESS_ERROR;
  return null;
}
