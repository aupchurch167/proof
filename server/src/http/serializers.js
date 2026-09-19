// Translates Proof's internal models into the public API contract shapes.
// Keeping this in one module means the COI status computation and money/date
// formatting have a single, testable definition every endpoint shares.

// Number of days before expiry at which a still-valid policy is "expiring soon".
// Mirrors the window used in services/compliance.js.
const EXPIRING_SOON_DAYS = 30;

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

function coverageStatus(expiration) {
  if (!expiration) return 'compliant'; // present, no known expiry
  const now = Date.now();
  const exp = new Date(expiration).getTime();
  if (exp < now) return 'expired';
  const days = (exp - now) / (1000 * 60 * 60 * 24);
  return days <= EXPIRING_SOON_DAYS ? 'expiring_soon' : 'compliant';
}

// Build the coverages[] array from a COI row, including only coverage lines that
// actually carry data (a limit, an expiration, or a policy number).
function coveragesFromCoi(coi) {
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
      status: coverageStatus(l.exp),
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
function serializeVendor(vendor, { latestApprovedCoi = null, lastRequestedAt = null, detail = false } = {}) {
  const coi = {
    status: mapCoiStatus(vendor.coiStatus),
    expiresAt: earliestExpiration(latestApprovedCoi),
    lastRequestedAt: isoDateTime(lastRequestedAt),
  };
  if (detail) {
    coi.coverages = coveragesFromCoi(latestApprovedCoi);
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

module.exports = {
  COVERAGE_TYPES,
  EXPIRING_SOON_DAYS,
  mapCoiStatus,
  internalStatusesFor,
  coveragesFromCoi,
  earliestExpiration,
  serializeVendor,
  serializeCoiRequest,
};
