const { CronJob } = require('cron');
const { sendExpirationReminderEmail, sendWeeklySummaryEmail } = require('./email');
const { updateVendorStatus } = require('./compliance');
const { generateUploadToken } = require('../utils/tokens');

function startExpirationCron(prisma) {
  // Run daily at 8 AM
  const job = new CronJob('0 8 * * *', async () => {
    console.log('[Cron] Running expiration check...');

    try {
      const orgs = await prisma.organization.findMany({
        include: { settings: true },
      });

      for (const org of orgs) {
        if (!org.settings) continue;

        const reminderDays = org.settings.reminderDaysBefore || [30, 14, 7, 0];
        if (!org.settings.notifyOnExpiration) continue;

        // Get all vendors with approved COIs
        const vendors = await prisma.vendor.findMany({
          where: { orgId: org.id, deletedAt: null },
          include: {
            cois: {
              where: { status: 'APPROVED' },
              orderBy: { submittedAt: 'desc' },
              take: 1,
            },
          },
        });

        for (const vendor of vendors) {
          // Update vendor status
          await updateVendorStatus(prisma, vendor.id, org.id);

          if (vendor.cois.length === 0) continue;

          const latestCoi = vendor.cois[0];
          const expirationDates = [
            latestCoi.glExpirationDate,
            latestCoi.wcExpirationDate,
            latestCoi.umbExpirationDate,
            latestCoi.autoExpirationDate,
          ].filter(Boolean);

          // Find earliest expiration
          const earliestExpiration = expirationDates.reduce(
            (min, d) => (d < min ? d : min),
            expirationDates[0]
          );

          if (!earliestExpiration) continue;

          const now = new Date();
          const daysUntil = Math.ceil((earliestExpiration - now) / (1000 * 60 * 60 * 24));

          // Check if this matches any reminder interval
          if (reminderDays.includes(daysUntil)) {
            const portalUrl = `${process.env.APP_URL}/portal/${vendor.uploadToken}`;

            // Check if we already sent a notification today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const alreadySent = await prisma.notificationLog.findFirst({
              where: {
                vendorId: vendor.id,
                type: 'EXPIRATION_REMINDER',
                sentAt: { gte: today },
              },
            });

            if (!alreadySent) {
              const cc = vendor.additionalEmails?.length > 0 ? vendor.additionalEmails : undefined;
              await sendExpirationReminderEmail(
                vendor.email,
                vendor.name,
                daysUntil,
                portalUrl,
                cc
              ).catch(console.error);

              await prisma.notificationLog.create({
                data: {
                  orgId: org.id,
                  vendorId: vendor.id,
                  coiId: latestCoi.id,
                  type: 'EXPIRATION_REMINDER',
                  recipientEmail: vendor.email,
                  status: 'SENT',
                },
              });

              console.log(`[Cron] Sent ${daysUntil}-day reminder to ${vendor.name} (${vendor.email})`);
            }
          }
        }
      }

      console.log('[Cron] Expiration check complete');
    } catch (err) {
      console.error('[Cron] Expiration check failed:', err);
    }
  });

  job.start();
  console.log('[Cron] Expiration reminder job scheduled (daily at 8 AM)');
}

function startTokenRefreshCron(prisma) {
  // Run every Sunday at midnight
  const job = new CronJob('0 0 * * 0', async () => {
    console.log('[Cron] Refreshing vendor upload tokens...');
    try {
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

      console.log(`[Cron] Refreshed upload tokens for ${vendors.length} vendor(s)`);
    } catch (err) {
      console.error('[Cron] Token refresh failed:', err);
    }
  });

  job.start();
  console.log('[Cron] Token refresh job scheduled (Sundays at midnight)');
}

function startWeeklySummaryCron(prisma) {
  // Run every Monday at 8 AM
  const job = new CronJob('0 8 * * 1', async () => {
    console.log('[Cron] Running weekly compliance summary...');

    try {
      const orgs = await prisma.organization.findMany({
        include: {
          users: {
            where: { role: 'ADMIN' },
            select: { email: true, firstName: true },
          },
        },
      });

      for (const org of orgs) {
        // Find admin to send to
        const admin = org.users[0];
        if (!admin) {
          console.log(`[Cron] Skipping org "${org.name}" — no admin user`);
          continue;
        }

        // Get all vendors for this org
        const vendors = await prisma.vendor.findMany({
          where: { orgId: org.id, deletedAt: null },
          include: {
            cois: {
              where: { status: 'APPROVED' },
              orderBy: { submittedAt: 'desc' },
              take: 1,
            },
          },
        });

        // Skip orgs with no vendors
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
          if (vendor.cois.length === 0) {
            noCoi++;
            continue;
          }

          const latestCoi = vendor.cois[0];
          const expirationDates = [
            latestCoi.glExpirationDate,
            latestCoi.wcExpirationDate,
            latestCoi.umbExpirationDate,
            latestCoi.autoExpirationDate,
          ].filter(Boolean);

          if (expirationDates.length === 0) {
            noCoi++;
            continue;
          }

          const earliestExpiration = expirationDates.reduce(
            (min, d) => (d < min ? d : min),
            expirationDates[0]
          );

          const daysUntil = Math.ceil((earliestExpiration - now) / (1000 * 60 * 60 * 24));

          if (daysUntil < 0) {
            expired++;
            urgentList.push({ name: vendor.name, expirationDate: earliestExpiration, daysUntil });
          } else if (daysUntil <= 30) {
            expiringSoon++;
            urgentList.push({ name: vendor.name, expirationDate: earliestExpiration, daysUntil });
          } else {
            compliant++;
          }
        }

        // Sort by most urgent (most negative / lowest daysUntil first), take top 5
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

      console.log('[Cron] Weekly compliance summary complete');
    } catch (err) {
      console.error('[Cron] Weekly summary job failed:', err);
    }
  });

  job.start();
  console.log('[Cron] Weekly summary job scheduled (Mondays at 8 AM)');
}

module.exports = { startExpirationCron, startTokenRefreshCron, startWeeklySummaryCron };
