// Translates Proof's internal models into the public API contract shapes.
// Keeping this in one module means the COI status computation and money/date
// formatting have a single, testable definition every endpoint shares.

const path = require('path');
const {
  DEFAULT_EXPIRING_WINDOW_DAYS,
  expiringWindowDays,
  isExpiredDate,
  isExpiringSoon,
} = require('../services/complianceRules');

// Matches getSignedUrl()'s default TTL so the envelope's expiresInSeconds /
// expiresAt describe the URL we actually issued.
const SIGNED_URL_EXPIRES_IN = 900;

// Default warn window when the caller does not pass org settings.
// Live responses use OrganizationSettings.expiringWindowDays.
const EXPIRING_SOON_DAYS = DEFAULT_EXPIRING_WINDOW_DAYS;

// Internal CoiStatus enum -> public status enum.
// NON_COMPLIANT (has a COI but coverage is insufficient) has no dedicated public
// bucket; it surfaces as `expired` — i.e. "not acceptable, needs a new COI" —
// matching how the Core integration collapses the same state.
const COI_STATUS_MAP = {
  COMPLIANT: 'compliant',
  EXPIRING_SOON: 'expiring_soon',
  EXPIRED: 'expired',
  NON_COMPLIANT: 'expired',
  PENDING: 'pending',
  NO_COI: 'none',
};

// Reverse map for filtering: one public value can match several internal ones.
const PUBLIC_TO_INTERNAL_STATUS = {
  compliant: ['COMPLIANT'],
  expiring_soon: ['EXPIRING_SOON'],
  expired: ['EXPIRED', 'NON_COMPLIANT'],
  pending: ['PENDING'],
  none: ['NO_COI'],
};

const COVERAGE_TYPES = ['general_liability', 'workers_comp', 'umbrella', 'auto'];

function mapCoiStatus(internal) {
  return COI_STATUS_MAP[internal] || 'none';
}

function internalStatusesFor(publicStatus) {
  return PUBLIC_TO_INTERNAL_STATUS[publicStatus] || null;
}

function isoDateTime(d) {
  return d ? new Date(d).toISOString() : null;
}

// Coverage/vendor expirations are calendar dates in the contract (YYYY-MM-DD).
function isoDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

// Coverage amounts are stored in cents; the contract expresses limits in whole
// dollars (e.g. 2000000 == $2M).
function centsToDollars(cents) {
  return cents == null ? null : Math.round(cents / 100);
}

function coverageStatus(expiration, windowDays, now) {
  if (!expiration) return 'compliant'; // present, no known expiry
  if (isExpiredDate(expiration, now)) return 'expired';
  if (isExpiringSoon(expiration, windowDays, now)) return 'expiring_soon';
  return 'compliant';
}

// Build the coverages[] array from a COI row, including only coverage lines that
// actually carry data (a limit, an expiration, or a policy number).
function coveragesFromCoi(coi, { windowDays = EXPIRING_SOON_DAYS, now = new Date() } = {}) {
  if (!coi) return [];
  const lines = [
    { type: 'general_liability', amount: coi.glCoverageAmount, exp: coi.glExpirationDate, policy: coi.glPolicyNumber },
    { type: 'workers_comp', amount: coi.wcCoverageAmount, exp: coi.wcExpirationDate, policy: coi.wcPolicyNumber },
    { type: 'umbrella', amount: coi.umbCoverageAmount, exp: coi.umbExpirationDate, policy: coi.umbPolicyNumber },
    { type: 'auto', amount: coi.autoCoverageAmount, exp: coi.autoExpirationDate, policy: coi.autoPolicyNumber },
  ];
  return lines
    .filter((l) => l.amount != null || l.exp != null || l.policy)
    .map((l) => ({
      type: l.type,
      status: coverageStatus(l.exp, windowDays, now),
      expiresAt: isoDate(l.exp),
      limit: centsToDollars(l.amount),
    }));
}

// Earliest expiration among a COI's coverages — drives the "expiring" badge.
function earliestExpiration(coi) {
  if (!coi) return null;
  const dates = [coi.glExpirationDate, coi.wcExpirationDate, coi.umbExpirationDate, coi.autoExpirationDate]
    .filter(Boolean)
    .map((d) => new Date(d).getTime());
  if (dates.length === 0) return null;
  return isoDate(new Date(Math.min(...dates)));
}

/**
 * Serialize a vendor to the public contract shape.
 * @param {object} vendor       Prisma Vendor row.
 * @param {object} opts
 * @param {object|null} opts.latestApprovedCoi  Newest APPROVED Coi row, or null.
 * @param {Date|null}   opts.lastRequestedAt    When a COI was last requested.
 * @param {boolean}     opts.detail             Include the coverages[] array.
 */
function serializeVendor(vendor, { latestApprovedCoi = null, lastRequestedAt = null, detail = false, settings = null, now = new Date() } = {}) {
  const windowDays = expiringWindowDays(settings);
  const coi = {
    status: mapCoiStatus(vendor.coiStatus),
    expiresAt: earliestExpiration(latestApprovedCoi),
    lastRequestedAt: isoDateTime(lastRequestedAt),
  };
  if (detail) {
    coi.coverages = coveragesFromCoi(latestApprovedCoi, { windowDays, now });
  }
  return {
    id: vendor.id,
    name: vendor.name,
    trade: vendor.trade || null,
    email: vendor.email,
    phone: vendor.phone || null,
    coreVendorId: vendor.coreId || null,
    coi,
  };
}

const REQUEST_STATUS_MAP = {
  REQUESTED: 'requested',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
};

function serializeCoiRequest(reqRow) {
  return {
    id: reqRow.id,
    vendorId: reqRow.vendorId,
    status: REQUEST_STATUS_MAP[reqRow.status] || reqRow.status.toLowerCase(),
    coverageTypes: reqRow.coverageTypes || [],
    note: reqRow.note || null,
    requestedByEmail: reqRow.requestedByEmail || null,
    requestedAt: isoDateTime(reqRow.createdAt),
  };
}

function serializeSignedDocument(pdfPath, url) {
  return {
    url,
    expiresInSeconds: SIGNED_URL_EXPIRES_IN,
    contentType: 'application/pdf',
    filename: path.posix.basename(pdfPath || '') || 'coi.pdf',
    expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRES_IN * 1000).toISOString(),
  };
}

/**
 * Historical approved COI row for GET /cois. `expiresAt` is the earliest
 * coverage expiration (YYYY-MM-DD) or null — we do not substitute submittedAt
 * here; that fallback is only used for the overlap filter.
 */
function serializeHistoricalCoi(coi, document, { settings = null, now = new Date() } = {}) {
  const windowDays = expiringWindowDays(settings);
  return {
    id: coi.id,
    vendorId: coi.vendorId,
    vendorName: coi.vendor?.name || null,
    submittedAt: isoDateTime(coi.submittedAt),
    expiresAt: earliestExpiration(coi),
    document,
    coverages: coveragesFromCoi(coi, { windowDays, now }),
    agentName: coi.agentName || null,
    agentEmail: coi.agentEmail || null,
    agentPhone: coi.agentPhone || null,
    insuranceCompany: coi.insuranceCompany || null,
  };
}

module.exports = {
  COVERAGE_TYPES,
  EXPIRING_SOON_DAYS,
  SIGNED_URL_EXPIRES_IN,
  mapCoiStatus,
  internalStatusesFor,
  coveragesFromCoi,
  earliestExpiration,
  serializeVendor,
  serializeCoiRequest,
  serializeSignedDocument,
  serializeHistoricalCoi,
};
