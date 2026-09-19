const { daysUntil, daysSince, earliestExpiration } = require('./reminders');
const { isPlaceholderEmail } = require('../utils/email');

// A request is "ignored" once it's this old with nothing back from the vendor.
const IGNORED_AFTER_DAYS = 7;

// Anything expiring inside this window is worth chasing today.
const EXPIRING_SOON_DAYS = 30;

function lastOf(list) {
  return list.length > 0 ? list[list.length - 1] : null;
}

/**
 * The ops view of "who do I chase today", assembled in one pass.
 *
 * Buckets are derived from COI records rather than the cached Vendor.coiStatus
 * so the cockpit is correct even between runs of the status cron. Buckets
 * deliberately overlap: a vendor with no COI who has also been ignoring an
 * upload request belongs in both noCoi and ignoredRequests.
 */
async function buildComplianceOverview(
  prisma,
  orgId,
  { now = new Date(), ignoredAfterDays = IGNORED_AFTER_DAYS } = {}
) {
  const [vendors, logs, escalations] = await Promise.all([
    prisma.vendor.findMany({
      where: { orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        contactName: true,
        phone: true,
        trade: true,
        coiStatus: true,
        cois: {
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            status: true,
            submittedAt: true,
            glExpirationDate: true,
            wcExpirationDate: true,
            umbExpirationDate: true,
            autoExpirationDate: true,
          },
        },
      },
    }),
    prisma.notificationLog.findMany({
      where: {
        orgId,
        vendorId: { not: null },
        type: { in: ['UPLOAD_REQUEST', 'UPLOAD_CHASE', 'MANUAL_CONTACT'] },
      },
      orderBy: { sentAt: 'asc' },
      select: { vendorId: true, type: true, status: true, sentAt: true },
    }),
    prisma.auditLog.findMany({
      where: { orgId, entity: 'vendor', action: 'chase_escalated' },
      orderBy: { createdAt: 'asc' },
      select: { entityId: true, createdAt: true },
    }),
  ]);

  const logsByVendor = new Map();
  for (const log of logs) {
    if (!logsByVendor.has(log.vendorId)) logsByVendor.set(log.vendorId, []);
    logsByVendor.get(log.vendorId).push(log);
  }

  const escalatedAtByVendor = new Map();
  for (const entry of escalations) {
    escalatedAtByVendor.set(entry.entityId, entry.createdAt);
  }

  const buckets = {
    noCoi: [],
    pendingReview: [],
    expiringSoon: [],
    expired: [],
    ignoredRequests: [],
  };

  for (const vendor of vendors) {
    const latestApproved = vendor.cois.find((c) => c.status === 'APPROVED') || null;
    const oldestPending = [...vendor.cois].reverse().find((c) => c.status === 'PENDING_REVIEW') || null;
    const latestSubmission = vendor.cois[0] || null;

    const expiration = earliestExpiration(latestApproved);
    const daysUntilExpiration = expiration ? daysUntil(expiration, now) : null;

    const vendorLogs = logsByVendor.get(vendor.id) || [];
    const lastRequest = lastOf(
      vendorLogs.filter((l) => l.type === 'UPLOAD_REQUEST' && l.status === 'SENT')
    );
    const lastRequestAt = lastRequest ? lastRequest.sentAt : null;
    const daysSinceRequest = lastRequestAt ? daysSince(lastRequestAt, now) : null;

    // Only count follow-ups belonging to the current request cycle.
    const chases = vendorLogs.filter(
      (l) => l.type === 'UPLOAD_CHASE' && l.status === 'SENT' && lastRequestAt && l.sentAt >= lastRequestAt
    );
    const lastContact = lastOf(vendorLogs.filter((l) => l.type === 'MANUAL_CONTACT'));
    const lastContactedAt = lastContact ? lastContact.sentAt : null;

    const escalatedAt = escalatedAtByVendor.get(vendor.id) || null;

    const entry = {
      id: vendor.id,
      name: vendor.name,
      email: vendor.email,
      contactName: vendor.contactName,
      phone: vendor.phone,
      trade: vendor.trade,
      coiStatus: vendor.coiStatus,
      badEmail: isPlaceholderEmail(vendor.email),
      earliestExpiration: expiration,
      daysUntilExpiration,
      latestCoiId: latestApproved ? latestApproved.id : null,
      latestSubmittedAt: latestSubmission ? latestSubmission.submittedAt : null,
      pendingCoiId: oldestPending ? oldestPending.id : null,
      pendingSince: oldestPending ? oldestPending.submittedAt : null,
      lastRequestAt,
      daysSinceRequest,
      chaseCount: chases.length,
      lastChaseAt: chases.length > 0 ? chases[chases.length - 1].sentAt : null,
      escalatedAt: lastRequestAt && escalatedAt && escalatedAt >= lastRequestAt ? escalatedAt : null,
      lastContactedAt,
    };

    if (oldestPending) buckets.pendingReview.push(entry);
    if (!latestApproved && !oldestPending) buckets.noCoi.push(entry);

    if (latestApproved && daysUntilExpiration !== null) {
      if (daysUntilExpiration < 0) buckets.expired.push(entry);
      else if (daysUntilExpiration <= EXPIRING_SOON_DAYS) buckets.expiringSoon.push(entry);
    }

    // Ignored: we asked, it's been a week or more, nothing came back, and
    // nobody has since recorded reaching the vendor another way.
    const respondedSinceRequest =
      lastRequestAt && latestSubmission && latestSubmission.submittedAt > lastRequestAt;
    const contactedSinceRequest = lastRequestAt && lastContactedAt && lastContactedAt > lastRequestAt;

    if (
      lastRequestAt &&
      daysSinceRequest >= ignoredAfterDays &&
      !respondedSinceRequest &&
      !contactedSinceRequest &&
      !latestApproved
    ) {
      buckets.ignoredRequests.push(entry);
    }
  }

  // Most urgent first in every bucket.
  const byName = (a, b) => a.name.localeCompare(b.name);
  buckets.expired.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration || byName(a, b));
  buckets.expiringSoon.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration || byName(a, b));
  buckets.pendingReview.sort((a, b) => new Date(a.pendingSince) - new Date(b.pendingSince) || byName(a, b));
  buckets.ignoredRequests.sort((a, b) => b.daysSinceRequest - a.daysSinceRequest || byName(a, b));
  // Never-requested vendors sort last: there's nothing to chase yet, only to send.
  buckets.noCoi.sort((a, b) => {
    const aDays = a.daysSinceRequest === null ? -1 : a.daysSinceRequest;
    const bDays = b.daysSinceRequest === null ? -1 : b.daysSinceRequest;
    return bDays - aDays || byName(a, b);
  });

  const counts = Object.fromEntries(
    Object.entries(buckets).map(([key, list]) => [key, list.length])
  );

  return {
    generatedAt: now,
    ignoredAfterDays,
    expiringSoonDays: EXPIRING_SOON_DAYS,
    totalVendors: vendors.length,
    badEmails: vendors.filter((v) => isPlaceholderEmail(v.email)).length,
    counts,
    buckets,
  };
}

module.exports = { buildComplianceOverview, IGNORED_AFTER_DAYS, EXPIRING_SOON_DAYS };
