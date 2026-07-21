const core = require('../lib/core');
const { emitCoiUpdated } = require('./webhookDispatcher');

function checkCompliance(extractedData, settings, orgName) {
  const flags = [];

  const checks = [
    { field: 'glCoverageAmount', min: settings.minGeneralLiability, label: 'General Liability' },
    { field: 'wcCoverageAmount', min: settings.minWorkersComp, label: 'Workers Compensation' },
    { field: 'umbCoverageAmount', min: settings.minUmbrella, label: 'Umbrella' },
    { field: 'autoCoverageAmount', min: settings.minAutomobile, label: 'Automobile' },
  ];

  for (const check of checks) {
    const value = extractedData[check.field];
    if (value === null || value === undefined) {
      flags.push({
        type: 'MISSING',
        field: check.field,
        label: check.label,
        message: `${check.label} coverage not found`,
      });
    } else if (value < check.min) {
      flags.push({
        type: 'INSUFFICIENT',
        field: check.field,
        label: check.label,
        required: check.min,
        actual: value,
        message: `${check.label} coverage ($${(value / 100).toLocaleString()}) is below minimum ($${(check.min / 100).toLocaleString()})`,
      });
    }
  }

  // Check expiration dates
  const now = new Date();
  const dateChecks = [
    { field: 'glExpirationDate', label: 'General Liability' },
    { field: 'wcExpirationDate', label: 'Workers Compensation' },
    { field: 'umbExpirationDate', label: 'Umbrella' },
    { field: 'autoExpirationDate', label: 'Automobile' },
  ];

  for (const check of dateChecks) {
    const dateStr = extractedData[check.field];
    if (dateStr) {
      const expDate = new Date(dateStr);
      if (expDate < now) {
        flags.push({
          type: 'EXPIRED',
          field: check.field,
          label: check.label,
          expirationDate: dateStr,
          message: `${check.label} coverage expired on ${dateStr}`,
        });
      }
    }
  }

  // Check certificate holder / additionally insured
  if (orgName && extractedData.certificateHolderName) {
    const holderNorm = extractedData.certificateHolderName.toLowerCase().trim();
    const orgNorm = orgName.toLowerCase().trim();
    const isMatch = holderNorm.includes(orgNorm) || orgNorm.includes(holderNorm);
    if (!isMatch) {
      flags.push({
        type: 'ADDITIONALLY_INSURED_MISMATCH',
        field: 'certificateHolderName',
        label: 'Additionally Insured',
        expected: orgName,
        actual: extractedData.certificateHolderName,
        message: `Certificate holder "${extractedData.certificateHolderName}" does not match organization "${orgName}"`,
      });
    }
  }

  return flags;
}

async function updateVendorStatus(prisma, vendorId, orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, settings: true },
  });
  const settings = org?.settings;

  // Get the latest approved COI
  const latestCoi = await prisma.coi.findFirst({
    where: { vendorId, status: 'APPROVED' },
    orderBy: { submittedAt: 'desc' },
  });

  let status;
  if (!latestCoi) {
    // No approved COI: pending if one is under review, otherwise none on file.
    const pendingCoi = await prisma.coi.findFirst({
      where: { vendorId, status: 'PENDING_REVIEW' },
    });
    status = pendingCoi ? 'PENDING' : 'NO_COI';
  } else {
    // Check if any coverage is expired
    const now = new Date();
    const expirationDates = [
      latestCoi.glExpirationDate,
      latestCoi.wcExpirationDate,
      latestCoi.umbExpirationDate,
      latestCoi.autoExpirationDate,
    ].filter(Boolean);

    const allExpired = expirationDates.length > 0 && expirationDates.every(d => d < now);
    const someExpiringSoon = expirationDates.some(d => {
      const daysUntil = (d - now) / (1000 * 60 * 60 * 24);
      return daysUntil > 0 && daysUntil <= 30;
    });

    // Check compliance
    const complianceFlags = settings ? checkCompliance({
      glCoverageAmount: latestCoi.glCoverageAmount,
      wcCoverageAmount: latestCoi.wcCoverageAmount,
      umbCoverageAmount: latestCoi.umbCoverageAmount,
      autoCoverageAmount: latestCoi.autoCoverageAmount,
      glExpirationDate: latestCoi.glExpirationDate?.toISOString(),
      wcExpirationDate: latestCoi.wcExpirationDate?.toISOString(),
      umbExpirationDate: latestCoi.umbExpirationDate?.toISOString(),
      autoExpirationDate: latestCoi.autoExpirationDate?.toISOString(),
      certificateHolderName: latestCoi.certificateHolderName,
    }, settings, org?.name) : [];

    if (allExpired) {
      status = 'EXPIRED';
    } else if (someExpiringSoon) {
      status = 'EXPIRING_SOON';
    } else if (complianceFlags.some(f => f.type === 'INSUFFICIENT' || f.type === 'MISSING')) {
      status = 'NON_COMPLIANT';
    } else {
      status = 'COMPLIANT';
    }
  }

  const prev = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { coiStatus: true } });
  const updated = await prisma.vendor.update({
    where: { id: vendorId },
    data: { coiStatus: status },
    select: { coreId: true },
  });
  mirrorComplianceStatusToCore(updated.coreId, status);

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

async function mirrorComplianceStatusToCore(coreId, coiStatus) {
  if (!core.isEnabled() || !coreId) return;
  try {
    await core.updateVendor(coreId, { complianceStatus: core.mapComplianceStatus(coiStatus) });
  } catch (err) {
    console.error('[Core] Failed to mirror compliance status:', core.formatError(err));
  }
}

module.exports = { checkCompliance, updateVendorStatus };
