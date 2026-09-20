const { CronJob } = require('cron');
const {
  sendExpirationReminderEmail,
  sendWeeklySummaryEmail,
  sendChaseEmail,
} = require('./email');
const { updateVendorStatus } = require('./compliance');
const { generateUploadToken } = require('../utils/tokens');
const { isPlaceholderEmail, placeholderReason } = require('../utils/email');
const {
  DEFAULT_REMINDER_DAYS,
  DEFAULT_CHASE_DAYS,
  normalizeDayList,
  daysUntil,
  daysSince,
  reminderWindowFor,
  chaseStepFor,
  shouldEscalateChase,
  earliestExpiration,
} = require('./reminders');
const { withAdvisoryLock, LOCK_KEYS } = require('../lib/advisoryLock');

// Both vendor-facing jobs mint a fresh token before emailing, the same way
// POST /api/vendors/:id/request-coi does. Vendors created by the import
// scripts still carry the default UUID, which the portal can't jwt.verify(),
// so without this their link 404s.
async function rotateUploadToken(prisma, vendorId) {
  const uploadToken = generateUploadToken(vendorId);
  await prisma.vendor.update({ where: { id: vendorId }, data: { uploadToken } });
  return `${process.env.APP_URL}/portal/${uploadToken}`;
}

function ccFor(vendor) {
  const extras = (vendor.additionalEmails || []).filter((e) => !isPlaceholderEmail(e));
  return extras.length > 0 ? extras : undefined;
}

/**
 * Daily expiration reminders.
 *
 * Reminders fire on the *window* a COI has entered rather than on an exact day
 * match, so a skipped run (deploy, outage) no longer drops the notification
 * entirely: a COI 27 days out still gets the "30 day" reminder. Each window
 * sends at most once per COI, tracked via NotificationLog.meta.window.
 */
async function expirationSweepBody(prisma, now) {
  const stats = { sent: 0, skipped: 0, failed: 0 };

  const orgs = await prisma.organization.findMany({ include: { settings: true } });

  for (const org of orgs) {
    if (!org.settings || !org.settings.notifyOnExpiration) continue;

    const reminderDays = normalizeDayList(org.settings.reminderDaysBefore, DEFAULT_REMINDER_DAYS);

    const vendors = await prisma.vendor.findMany({
      where: { orgId: org.id, deletedAt: null },
      include: {
        cois: {
          where: { status: 'APPROVED', deletedAt: null },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    });

    for (const vendor of vendors) {
      await updateVendorStatus(prisma, vendor.id, org.id);

      const latestCoi = vendor.cois[0];
      if (!latestCoi) continue;

      const expiration = earliestExpiration(latestCoi);
      if (!expiration) continue;

      const days = daysUntil(expiration, now);
      const window = reminderWindowFor(days, reminderDays);
      if (window === null) continue;

      // One notification per (COI, window) — including the skip we record for
      // an unroutable address, so a bad email doesn't log every morning.
      const prior = await prisma.notificationLog.findMany({
        where: { vendorId: vendor.id, coiId: latestCoi.id, type: 'EXPIRATION_REMINDER' },
        select: { status: true, meta: true },
      });
      if (prior.some((log) => log.meta && log.meta.window === window)) {
        stats.skipped++;
        continue;
      }

      const base = {
        orgId: org.id,
        vendorId: vendor.id,
        coiId: latestCoi.id,
        type: 'EXPIRATION_REMINDER',
        recipientEmail: vendor.email,
      };

      if (isPlaceholderEmail(vendor.email)) {
        await prisma.notificationLog.create({
          data: {
            ...base,
            status: 'FAILED',
            meta: { window, daysUntil: days, reason: placeholderReason(vendor.email) },
          },
        });
        stats.failed++;
        console.warn(`[Cron] Skipped ${window}-day reminder for ${vendor.name} — unroutable address "${vendor.email}"`);
        continue;
      }

      try {
        const portalUrl = await rotateUploadToken(prisma, vendor.id);
        await sendExpirationReminderEmail(vendor.email, vendor.name, days, portalUrl, ccFor(vendor));

        await prisma.notificationLog.create({
          data: { ...base, status: 'SENT', meta: { window, daysUntil: days } },
        });
        stats.sent++;
        console.log(`[Cron] Sent ${window}-day reminder to ${vendor.name} (${vendor.email}), ${days} day(s) out`);
      } catch (err) {
        await prisma.notificationLog.create({
          data: {
            ...base,
            status: 'FAILED',
            meta: { window, daysUntil: days, reason: 'SEND_ERROR', error: err.message },
          },
        }).catch(() => {});
        stats.failed++;
        console.error(`[Cron] Failed ${window}-day reminder for ${vendor.name}:`, err.message);
      }
    }
  }

  return stats;
}

async function runExpirationSweep(prisma, { now = new Date() } = {}) {
  const lock = await withAdvisoryLock(LOCK_KEYS.expiration, () => expirationSweepBody(prisma, now));
  if (!lock.acquired) {
    console.log('[Cron] Expiration sweep skipped — advisory lock not acquired');
    return { sent: 0, skipped: 0, failed: 0, acquired: false };
  }
  return { ...lock.result, acquired: true };
}

/**
 * Daily non-responder chase.
 *
 * A vendor who was sent an upload request and never uploaded gets follow-ups
 * at the org's configured offsets (3/7/14 days by default). Once every
 * follow-up has gone out and the vendor is still silent, the request is
 * escalated to an audit-log flag so it surfaces in the compliance cockpit
 * instead of quietly aging out.
 */
async function chaseSweepBody(prisma, now) {
  const stats = { sent: 0, skipped: 0, failed: 0, escalated: 0 };

  const orgs = await prisma.organization.findMany({ include: { settings: true } });

  for (const org of orgs) {
    if (!org.settings || org.settings.chaseNonResponders === false) continue;

    const chaseDays = normalizeDayList(org.settings.chaseDaysAfterRequest, DEFAULT_CHASE_DAYS)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (chaseDays.length === 0) continue;

    const vendors = await prisma.vendor.findMany({
      where: { orgId: org.id, deletedAt: null },
    });

    for (const vendor of vendors) {
      const lastRequest = await prisma.notificationLog.findFirst({
        where: { vendorId: vendor.id, type: 'UPLOAD_REQUEST', status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        select: { id: true, sentAt: true },
      });
      if (!lastRequest) continue;

      // Any upload after the request means they responded — nothing to chase.
      const uploadsSince = await prisma.coi.count({
        where: { vendorId: vendor.id, deletedAt: null, submittedAt: { gt: lastRequest.sentAt } },
      });
      if (uploadsSince > 0) continue;

      const days = daysSince(lastRequest.sentAt, now);
      const step = chaseStepFor(days, chaseDays);
      if (step === null) continue;

      // Chases are scoped to the request that triggered them, so a fresh
      // request restarts the ladder from the first step.
      const prior = await prisma.notificationLog.findMany({
        where: {
          vendorId: vendor.id,
          type: 'UPLOAD_CHASE',
          sentAt: { gte: lastRequest.sentAt },
        },
        select: { status: true, meta: true },
      });

      if (prior.some((log) => log.meta && log.meta.step === step)) {
        stats.skipped++;
      } else {
        const base = {
          orgId: org.id,
          vendorId: vendor.id,
          type: 'UPLOAD_CHASE',
          recipientEmail: vendor.email,
        };

        if (isPlaceholderEmail(vendor.email)) {
          await prisma.notificationLog.create({
            data: {
              ...base,
              status: 'FAILED',
              meta: { step, daysSinceRequest: days, reason: placeholderReason(vendor.email) },
            },
          });
          stats.failed++;
          console.warn(`[Cron] Skipped day-${step} chase for ${vendor.name} — unroutable address "${vendor.email}"`);
        } else {
          try {
            const portalUrl = await rotateUploadToken(prisma, vendor.id);
            await sendChaseEmail(vendor.email, vendor.name, portalUrl, org, days, ccFor(vendor));

            await prisma.notificationLog.create({
              data: { ...base, status: 'SENT', meta: { step, daysSinceRequest: days } },
            });
            stats.sent++;
            console.log(`[Cron] Sent day-${step} chase to ${vendor.name} (${vendor.email})`);
          } catch (err) {
            await prisma.notificationLog.create({
              data: {
                ...base,
                status: 'FAILED',
                meta: { step, daysSinceRequest: days, reason: 'SEND_ERROR', error: err.message },
              },
            }).catch(() => {});
            stats.failed++;
            console.error(`[Cron] Failed day-${step} chase for ${vendor.name}:`, err.message);
          }
        }
      }

      if (shouldEscalateChase(days, chaseDays)) {
        const escalated = await escalateIgnoredRequest(prisma, org, vendor, lastRequest, days, chaseDays);
        if (escalated) stats.escalated++;
      }
    }
  }

  return stats;
}

async function runChaseSweep(prisma, { now = new Date() } = {}) {
  const lock = await withAdvisoryLock(LOCK_KEYS.chase, () => chaseSweepBody(prisma, now));
  if (!lock.acquired) {
    console.log('[Cron] Chase sweep skipped — advisory lock not acquired');
    return { sent: 0, skipped: 0, failed: 0, escalated: 0, acquired: false };
  }
  return { ...lock.result, acquired: true };
}

// Flag a request the vendor has ignored through the whole chase ladder. Writes
// one audit entry per request so the cockpit can surface it without the job
// re-flagging the same vendor every morning.
async function escalateIgnoredRequest(prisma, org, vendor, lastRequest, days, chaseDays) {
  const already = await prisma.auditLog.findFirst({
    where: {
      orgId: org.id,
      entity: 'vendor',
      entityId: vendor.id,
      action: 'chase_escalated',
      createdAt: { gte: lastRequest.sentAt },
    },
    select: { id: true },
  });
  if (already) return false;

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      action: 'chase_escalated',
      entity: 'vendor',
      entityId: vendor.id,
      details: {
        vendorName: vendor.name,
        vendorEmail: vendor.email,
        requestedAt: lastRequest.sentAt,
        daysSinceRequest: days,
        chaseDays,
        badEmail: isPlaceholderEmail(vendor.email),
        reason: 'No COI uploaded after all configured follow-ups',
      },
    },
  });

  console.warn(`[Cron] Escalated ignored COI request for ${vendor.name} (${days} days, no upload)`);
  return true;
}

function startExpirationCron(prisma) {
  // Run daily at 8 AM
  const job = new CronJob('0 8 * * *', async () => {
    console.log('[Cron] Running expiration check...');
    try {
      const stats = await runExpirationSweep(prisma);
      console.log(`[Cron] Expiration check complete — ${stats.sent} sent, ${stats.skipped} already notified, ${stats.failed} failed`);
    } catch (err) {
      console.error('[Cron] Expiration check failed:', err);
    }
  });

  job.start();
  console.log('[Cron] Expiration reminder job scheduled (daily at 8 AM)');
  return job;
}

function startChaseCron(prisma) {
  // Run daily at 9 AM, an hour after the expiration sweep so the two jobs
  // don't compete for the same DB connections or email quota.
  const job = new CronJob('0 9 * * *', async () => {
    console.log('[Cron] Running non-responder chase...');
    try {
      const stats = await runChaseSweep(prisma);
      console.log(`[Cron] Chase complete — ${stats.sent} sent, ${stats.skipped} already chased, ${stats.failed} failed, ${stats.escalated} escalated`);
    } catch (err) {
      console.error('[Cron] Chase failed:', err);
    }
  });

  job.start();
  console.log('[Cron] Non-responder chase job scheduled (daily at 9 AM)');
  return job;
}

async function runTokenRefresh(prisma) {
  const lock = await withAdvisoryLock(LOCK_KEYS.tokenRefresh, async () => {
    const vendors = await prisma.vendor.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    for (const vendor of vendors) {
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { uploadToken: generateUploadToken(vendor.id) },
      });
    }

    return vendors.length;
  });

  if (!lock.acquired) {
    console.log('[Cron] Token refresh skipped — advisory lock not acquired');
    return { acquired: false, refreshed: 0 };
  }
  return { acquired: true, refreshed: lock.result };
}

function startTokenRefreshCron(prisma) {
  // Run every Sunday at midnight
  const job = new CronJob('0 0 * * 0', async () => {
    console.log('[Cron] Refreshing vendor upload tokens...');
    try {
      const stats = await runTokenRefresh(prisma);
      if (stats.acquired) {
        console.log(`[Cron] Refreshed upload tokens for ${stats.refreshed} vendor(s)`);
      }
    } catch (err) {
      console.error('[Cron] Token refresh failed:', err);
    }
  });

  job.start();
  console.log('[Cron] Token refresh job scheduled (Sundays at midnight)');
  return job;
}

async function runWeeklySummary(prisma) {
  const lock = await withAdvisoryLock(LOCK_KEYS.weeklySummary, async () => {
    const orgs = await prisma.organization.findMany({
      include: {
        users: {
          where: { role: 'ADMIN' },
          select: { email: true, firstName: true },
        },
      },
    });

    for (const org of orgs) {
      const admin = org.users[0];
      if (!admin) {
        console.log(`[Cron] Skipping org "${org.name}" — no admin user`);
        continue;
      }

      const vendors = await prisma.vendor.findMany({
        where: { orgId: org.id, deletedAt: null },
        include: {
          cois: {
            where: { status: 'APPROVED', deletedAt: null },
            orderBy: { submittedAt: 'desc' },
            take: 1,
          },
        },
      });

      if (vendors.length === 0) {
        console.log(`[Cron] Skipping org "${org.name}" — no vendors`);
        continue;
      }

      const now = new Date();
      let compliant = 0;
      let expiringSoon = 0;
      let expired = 0;
      let noCoi = 0;
      const urgentList = [];

      for (const vendor of vendors) {
        const latestCoi = vendor.cois[0];
        const earliestExpirationDate = earliestExpiration(latestCoi);

        if (!earliestExpirationDate) {
          noCoi++;
          continue;
        }

        const days = daysUntil(earliestExpirationDate, now);

        if (days < 0) {
          expired++;
          urgentList.push({ name: vendor.name, expirationDate: earliestExpirationDate, daysUntil: days });
        } else if (days <= 30) {
          expiringSoon++;
          urgentList.push({ name: vendor.name, expirationDate: earliestExpirationDate, daysUntil: days });
        } else {
          compliant++;
        }
      }

      urgentList.sort((a, b) => a.daysUntil - b.daysUntil);
      const urgentVendors = urgentList.slice(0, 5);

      const summary = {
        totalVendors: vendors.length,
        compliant,
        expiringSoon,
        expired,
        noCoi,
        urgentVendors,
      };

      try {
        await sendWeeklySummaryEmail(admin.email, org.name, summary);

        await prisma.notificationLog.create({
          data: {
            orgId: org.id,
            type: 'WEEKLY_SUMMARY',
            recipientEmail: admin.email,
            status: 'SENT',
          },
        });

        console.log(`[Cron] Weekly summary sent to ${admin.email} for org "${org.name}" (${vendors.length} vendors, ${expired} expired, ${expiringSoon} expiring)`);
      } catch (err) {
        console.error(`[Cron] Failed to send weekly summary for org "${org.name}":`, err.message);

        await prisma.notificationLog.create({
          data: {
            orgId: org.id,
            type: 'WEEKLY_SUMMARY',
            recipientEmail: admin.email,
            status: 'FAILED',
          },
        }).catch(() => {});
      }
    }

    return true;
  });

  if (!lock.acquired) {
    console.log('[Cron] Weekly summary skipped — advisory lock not acquired');
    return { acquired: false };
  }
  return { acquired: true };
}

function startWeeklySummaryCron(prisma) {
  // Run every Monday at 8 AM
  const job = new CronJob('0 8 * * 1', async () => {
    console.log('[Cron] Running weekly compliance summary...');
    try {
      const stats = await runWeeklySummary(prisma);
      if (stats.acquired) {
        console.log('[Cron] Weekly compliance summary complete');
      }
    } catch (err) {
      console.error('[Cron] Weekly summary job failed:', err);
    }
  });

  job.start();
  console.log('[Cron] Weekly summary job scheduled (Mondays at 8 AM)');
  return job;
}

function startCronJobs(prisma) {
  return [
    startExpirationCron(prisma),
    startChaseCron(prisma),
    startTokenRefreshCron(prisma),
    startWeeklySummaryCron(prisma),
  ];
}

function stopCronJobs(jobs) {
  for (const job of jobs || []) {
    if (job && typeof job.stop === 'function') job.stop();
  }
}

module.exports = {
  startExpirationCron,
  startChaseCron,
  startTokenRefreshCron,
  startWeeklySummaryCron,
  startCronJobs,
  stopCronJobs,
  runExpirationSweep,
  runChaseSweep,
  runTokenRefresh,
  runWeeklySummary,
};
