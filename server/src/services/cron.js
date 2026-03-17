const { CronJob } = require('cron');
const { sendExpirationReminderEmail } = require('./email');
const { updateVendorStatus } = require('./compliance');

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
              await sendExpirationReminderEmail(
                vendor.email,
                vendor.name,
                daysUntil,
                portalUrl
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

module.exports = { startExpirationCron };
