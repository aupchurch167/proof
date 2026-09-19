/**
 * Helpers for deciding whether an address is worth emailing.
 *
 * Vendors imported from Airtable rows with no contact address get a
 * synthesized one (see scripts/import-airtable-vendors.js) so the row can
 * still land in Proof. Those addresses are unroutable by design — sending to
 * them burns sender reputation and buries a real bounce in the noise, so every
 * automated send skips them and logs the skip as FAILED instead.
 */

// Reserved TLDs (RFC 2606 / RFC 6761) plus the synthetic domain the Airtable
// importer uses. Nothing behind these ever accepts mail.
const PLACEHOLDER_TLDS = new Set(['local', 'invalid', 'example', 'test', 'localhost']);
const PLACEHOLDER_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);

function isPlaceholderEmail(email) {
  if (!email || typeof email !== 'string') return true;

  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return true;

  const domain = trimmed.slice(at + 1);
  if (PLACEHOLDER_DOMAINS.has(domain)) return true;

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return PLACEHOLDER_TLDS.has(tld);
}

// Why a given address was skipped, for the NotificationLog meta blob.
function placeholderReason(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'MISSING_EMAIL';
  return 'PLACEHOLDER_EMAIL';
}

module.exports = { isPlaceholderEmail, placeholderReason };
