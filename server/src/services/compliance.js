const core = require('../lib/core');
const { emitCoiUpdated } = require('./webhookDispatcher');
const { coverageFor, coverageReason, coverageFailureReasons } = require('./coverage');
const { mergeApprovedCois } = require('./effectiveCoverage');
const {
  evaluateCompliance,
  isExpiredDate,
  isExpiringSoon,
  holderDetailReason,
  DEFAULT_EXPIRING_WINDOW_DAYS,
} = require('./complianceRules');

function checkCompliance(extractedData, settings, orgName, options) {
  return evaluateCompliance(extractedData, settings, orgName, options).flags;
}

function coiPayload(coi) {
  return {
    glCoverageAmount: coi.glCoverageAmount,
    wcCoverageAmount: coi.wcCoverageAmount,
    umbCoverageAmount: coi.umbCoverageAmount,
    autoCoverageAmount: coi.autoCoverageAmount,
    glPolicyNumber: coi.glPolicyNumber,
    wcPolicyNumber: coi.wcPolicyNumber,
    umbPolicyNumber: coi.umbPolicyNumber,
    autoPolicyNumber: coi.autoPolicyNumber,
    glExpirationDate: coi.glExpirationDate,
    wcExpirationDate: coi.wcExpirationDate,
    umbExpirationDate: coi.umbExpirationDate,
    autoExpirationDate: coi.autoExpirationDate,
    certificateHolderName: coi.certificateHolderName,
  };
}

// Orgs always have a settings row. This fallback only runs if that row is
// missing: dates still matter, amount and holder rules do not.
function statusWithoutSettings(coi, now) {
  const expirationDates = [
    coi.glExpirationDate,
    coi.wcExpirationDate,
    coi.umbExpirationDate,
    coi.autoExpirationDate,
  ].filter(Boolean);

  const allExpired = expirationDates.length > 0 && expirationDates.every((date) => isExpiredDate(date, now));
  const someExpiringSoon = expirationDates.some((date) => isExpiringSoon(date, DEFAULT_EXPIRING_WINDOW_DAYS, now));
  if (allExpired) return 'EXPIRED';
  if (someExpiringSoon) return 'EXPIRING_SOON';
  return 'COMPLIANT';
}

// One reading of a vendor's certificates. The list badge, coverage chips,
// dashboard counts, and the stored coiStatus all go through this so a stale
// Vendor.coiStatus cannot disagree with the lines on screen.
function assessVendorCompliance({ cois, settings, orgName, now = new Date() } = {}) {
  const rows = (cois || []).filter((coi) => coi && !coi.deletedAt);
  const pending = rows.some((coi) => coi.status === 'PENDING_REVIEW');
  const merged = mergeApprovedCois(rows);
  const coverages = coverageFor(merged, settings, { now });

  let status;
  let evaluated = null;
  if (!merged) {
    status = pending ? 'PENDING' : 'NO_COI';
  } else if (!settings) {
    status = statusWithoutSettings(merged, now);
  } else {
    evaluated = evaluateCompliance(coiPayload(merged), settings, orgName, { now });
    status = evaluated.status;
  }

  const nextExpiration = coverages
    .filter((line) => line.expiresAt && line.verdict !== 'skipped')
    .map((line) => line.expiresAt)
    .sort()[0] || null;

  const holder = holderDetailReason(evaluated);
  const failures = coverageFailureReasons(coverages);
  const reasons = [];
  if (holder) reasons.push(holder);
  if (failures.length) reasons.push(...failures);
  else if (!holder) {
    const soon = coverageReason(coverages);
    if (soon) reasons.push(soon);
  }

  return {
    status,
    coverages,
    merged,
    evaluated,
    nextExpiration,
    statusReason: reasons.length ? reasons.join(' · ') : null,
    pending,
  };
}

const STATUS_COUNT_KEY = {
  COMPLIANT: 'compliant',
  NON_COMPLIANT: 'nonCompliant',
  EXPIRING_SOON: 'expiringSoon',
  EXPIRED: 'expired',
  PENDING: 'pending',
  NO_COI: 'noCoi',
};

async function countVendorCompliance(prisma, orgId, now = new Date()) {
  const [org, vendors] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, settings: true },
    }),
    prisma.vendor.findMany({
      where: { orgId, deletedAt: null },
      select: {
        cois: {
          where: { deletedAt: null },
          orderBy: { submittedAt: 'desc' },
        },
      },
    }),
  ]);

  const summary = {
    total: vendors.length,
    compliant: 0,
    nonCompliant: 0,
    expiringSoon: 0,
    expired: 0,
    pending: 0,
    noCoi: 0,
  };

  for (const vendor of vendors) {
    const assessed = assessVendorCompliance({
      cois: vendor.cois,
      settings: org?.settings,
      orgName: org?.name,
      now,
    });
    const key = STATUS_COUNT_KEY[assessed.status];
    if (key) summary[key] += 1;
  }

  return summary;
}

async function updateVendorStatus(prisma, vendorId, orgId, { now = new Date() } = {}) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, settings: true },
  });
  const settings = org?.settings;

  const cois = await prisma.coi.findMany({
    where: { vendorId, deletedAt: null },
    orderBy: { submittedAt: 'desc' },
  });
  const assessed = assessVendorCompliance({
    cois,
    settings,
    orgName: org?.name,
    now,
  });
  const status = assessed.status;
  const latestCoi = assessed.merged;

  const prev = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { coiStatus: true } });
  const updated = await prisma.vendor.update({
    where: { id: vendorId },
    data: { coiStatus: status },
    select: { coreId: true, orgId: true },
  });
  mirrorComplianceStatusToCore(updated.coreId, status, updated);

  // A valid COI resolves any outstanding COI request so "is a request open?"
  // stays accurate for API consumers.
  if (status === 'COMPLIANT' || status === 'EXPIRING_SOON') {
    await prisma.coiRequest.updateMany({
      where: { vendorId, status: 'REQUESTED' },
      data: { status: 'FULFILLED', fulfilledAt: new Date() },
    });
  }

  // Notify external subscribers only when the status actually changes.
  // Best-effort: never block or fail status computation on webhook delivery.
  if (!prev || prev.coiStatus !== status) {
    emitCoiUpdated({ orgId, vendorId, coiStatus: status, latestApprovedCoi: latestCoi || null })
      .catch((err) => console.error('[Webhook] emit failed:', err.message));
  }
}

async function mirrorComplianceStatusToCore(coreId, coiStatus, vendor) {
  if (!core.isEnabled() || !coreId) return;
  if (vendor && !(await core.shouldMirror(vendor))) return;
  try {
    await core.updateVendor(coreId, { complianceStatus: core.mapComplianceStatus(coiStatus) }, vendor);
  } catch (err) {
    console.error('[Core] Failed to mirror compliance status:', core.formatError(err));
  }
}

module.exports = {
  checkCompliance,
  updateVendorStatus,
  evaluateCompliance,
  assessVendorCompliance,
  countVendorCompliance,
};
