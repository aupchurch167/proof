// Draft legal placeholders. Counsel replaces the bodies; keep versions in
// lockstep with client/src/legal/documents.js when the text is swapped.

const TERMS_VERSION = 'draft-2026-09-21';
const PRIVACY_VERSION = 'draft-2026-09-21';

const DRAFT_BANNER =
  'DRAFT — not counsel-approved. This is a placeholder for counsel to replace. ' +
  'It is not a final legal document and is not legal advice.';

const TERMS_SECTIONS = [
  {
    heading: '1. What this is',
    body:
      'These draft terms describe how Proof (proofcoi.com) is intended to work: a tool for general contractors and similar organizations to request, store, and review vendor certificates of insurance (COIs). A lawyer has not approved this text. Do not treat it as an enforceable Terms of Service.',
  },
  {
    heading: '2. The service (placeholder)',
    body:
      'Proof provides accounts for organizations, vendor records, COI uploads, reminders, and related compliance workflows. Features that the product UI labels as coming soon, invoiced, or not self-serve are not part of a paid entitlement until they actually exist. Counsel will define license, acceptable use, and customer obligations here.',
  },
  {
    heading: '3. Accounts (placeholder)',
    body:
      'You must provide accurate account information and keep credentials confidential. Password sign-up requires a verified email before the product can be used. Google sign-in is optional. Counsel will define age limits, organizational authority, and suspension rights.',
  },
  {
    heading: '4. Customer data (placeholder)',
    body:
      'Organizations upload vendor contact details, COI PDFs, and (when collected through authenticated product flows) tax documents such as W-9s. Public apply forms do not accept W-9s. Counsel will define ownership, licenses to host data, and confidentiality.',
  },
  {
    heading: '5. Warranties and liability (placeholder — counsel must rewrite)',
    body:
      'This draft does not state a warranty disclaimer or limitation of liability. Those clauses must be written by counsel. Until then, this document does not attempt to allocate risk.',
  },
  {
    heading: '6. Contact',
    body:
      'Questions about this draft: use the contact path published on proofcoi.com. Replace this section with the legal entity name, address, and counsel-approved notice method.',
  },
];

const PRIVACY_SECTIONS = [
  {
    heading: '1. What this is',
    body:
      'This draft privacy notice describes, from the engineering inventory, what Proof currently collects and which processors the codebase talks to. A lawyer has not approved this text. It is not a final privacy policy, DPA, or cookie notice.',
  },
  {
    heading: '2. Data we store',
    body:
      'Account name, email, password hash or Google subject, organization profile, vendor contacts, COI fields and PDFs, optional W-9 / master-agreement files collected in authenticated flows, notification logs, and audit logs (including IP when an action is audited). Auth tokens are stored in the browser localStorage, not in first-party cookies.',
  },
  {
    heading: '3. Subprocessors and third parties (from the system map)',
    body:
      'Proof currently sends or stores customer data with: a hosted PostgreSQL database (Prisma; production host is not named in the repo — treat the database operator as a subprocessor); DigitalOcean Spaces for private COI / W-9 / master-agreement / reply-attachment objects (15-minute signed URLs); Resend for transactional email and inbound reply webhooks; Anthropic for COI PDF extraction; Google Identity Services when Google sign-in is enabled (GIS may set cookies on accounts.google.com — those are Google’s, not first-party Proof cookies). Optional: Helm Core, if an operator turns on the vendor-mirror flag. Railway may host an instance; Nginx / Let’s Encrypt terminate TLS. Airtable appears only in one-time import scripts, not the live request path. Stripe and similar payment processors are not present.',
  },
  {
    heading: '4. Cookies and localStorage',
    body:
      'Proof does not set first-party auth cookies. Access and refresh tokens live in localStorage. If Google Identity Services is enabled, Google may set its own cookies on Google domains. This draft is not a cookie banner and does not claim “we only use essential cookies.” Counsel must decide whether a banner is required.',
  },
  {
    heading: '5. Not for PHI',
    body:
      'Proof is built for construction / vendor COI workflows. It is not intended for protected health information, and this draft does not claim HIPAA compliance.',
  },
  {
    heading: '6. Retention and your requests (placeholder)',
    body:
      'Counsel will define retention, deletion, and data-subject request processes. Engineering export / erase is not fully implemented. Existing stored W-9s are not deleted by the public-apply gate.',
  },
  {
    heading: '7. Contact',
    body:
      'Questions about this draft: use the contact path published on proofcoi.com. Replace this section with the controller identity and counsel-approved privacy contact.',
  },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sectionsToHtml(sections) {
  return sections
    .map(
      (section) =>
        `<h2>${escapeHtml(section.heading)}</h2>\n<p>${escapeHtml(section.body)}</p>`
    )
    .join('\n');
}

function wrapLegalPage({ title, version, sections }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — Proof (DRAFT)</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.55; color: #1a1a1a; }
    .draft { background: #fff4cc; border: 1px solid #c9a227; padding: 0.75rem 1rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.75rem; }
    h2 { font-size: 1.15rem; margin-top: 1.75rem; }
    .meta { color: #666; font-size: 0.875rem; }
    a { color: #1e3a5f; }
  </style>
</head>
<body>
  <p class="draft"><strong>${escapeHtml(DRAFT_BANNER)}</strong></p>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Document version: ${escapeHtml(version)}</p>
  ${sectionsToHtml(sections)}
  <p class="meta"><a href="/">Proof</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
</body>
</html>`;
}

function legalAcceptanceFields(now = new Date()) {
  return {
    termsAcceptedAt: now,
    termsVersion: TERMS_VERSION,
    privacyAcceptedAt: now,
    privacyVersion: PRIVACY_VERSION,
  };
}

function acceptedLegal(value) {
  return value === true || value === 'true';
}

module.exports = {
  TERMS_VERSION,
  PRIVACY_VERSION,
  DRAFT_BANNER,
  TERMS_SECTIONS,
  PRIVACY_SECTIONS,
  wrapLegalPage,
  legalAcceptanceFields,
  acceptedLegal,
};
