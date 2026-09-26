const core = require('../lib/core');
const { emitCoiUpdated } = require('./webhookDispatcher');
const {
  evaluateCompliance,
  isExpiredDate,
  isExpiringSoon,
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

async function updateVendorStatus(prisma, vendorId, orgId, { now = new Date() } = {}) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, settings: true },
  });
  const settings = org?.settings;

  // Get the latest approved COI
  const latestCoi = await prisma.coi.findFirst({
    where: { vendorId, status: 'APPROVED', deletedAt: null },
    orderBy: { submittedAt: 'desc' },
  });

  let status;
  if (!latestCoi) {
    // No approved COI: pending if one is under review, otherwise none on file.
    const pendingCoi = await prisma.coi.findFirst({
      where: { vendorId, status: 'PENDING_REVIEW', deletedAt: null },
    });
    status = pendingCoi ? 'PENDING' : 'NO_COI';
  } else if (!settings) {
    status = statusWithoutSettings(latestCoi, now);
  } else {
    status = evaluateCompliance(coiPayload(latestCoi), settings, org?.name, { now }).status;
  }

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

module.exports = { checkCompliance, updateVendorStatus, evaluateCompliance };
