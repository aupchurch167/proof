// Account emails are stored and compared in one form: trimmed and lowercased.
// Lookups still find a legacy mixed-case row so a migration never has to
// delete or merge two real accounts that differ only by case.

function normalizeEmail(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

// Distinct messages so the form can tell an empty box, a non-email, and a
// partial address (a@b) apart.
function emailFieldError(value) {
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

// `extra` is a Prisma argument fragment (`include` / `select`). When several
// legacy rows differ only by case, the oldest wins and nothing is deleted.
async function findUserByEmail(prisma, email, extra = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized || emailFieldError(email)) return null;

  const exact = await prisma.user.findUnique({
    where: { email: normalized },
    ...extra,
  });
  if (exact) return exact;

  const matches = await prisma.user.findMany({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    ...extra,
  });
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const trimmed = String(email).trim();
  return matches.find((row) => row.email === trimmed)
    || matches.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
}

module.exports = { normalizeEmail, emailFieldError, findUserByEmail };
