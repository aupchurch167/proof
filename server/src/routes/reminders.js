const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
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
} = require('../services/reminders');
const { isPlaceholderEmail } = require('../utils/email');

const router = express.Router();

// Tone for the stage pill: the closer to expiry, the louder.
function stageFor(window, reminderDays) {
  const ordered = [...reminderDays].sort((a, b) => b - a);
  const last = ordered[ordered.length - 1];
  if (window === last) return { label: 'Final', tone: 'bad' };
  if (window <= 7) return { label: `${window} days`, tone: 'warn' };
  if (window <= 14) return { label: `${window} days`, tone: 'warn' };
  return { label: `${window} days`, tone: 'info' };
}

/**
 * GET /api/reminders/upcoming
 *
 * What the daily jobs will do next, derived from the same window maths the
 * cron itself uses — so this screen can't drift from what actually sends.
 * Returns the scheduled sends, the vendors who have stopped responding, and
 * the renewal rate over the last 30 days.
 */
router.get('/upcoming', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const settings = await prisma.organizationSettings.findUnique({
      where: { orgId: req.user.orgId },
    });
    const reminderDays = normalizeDayList(settings?.reminderDaysBefore, DEFAULT_REMINDER_DAYS);
    const chaseDays = normalizeDayList(settings?.chaseDaysAfterRequest, DEFAULT_CHASE_DAYS)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);

    const vendors = await prisma.vendor.findMany({
      where: { orgId: req.user.orgId, deletedAt: null },
      include: {
        cois: { where: { status: 'APPROVED' }, orderBy: { submittedAt: 'desc' }, take: 1 },
        notifications: {
          where: { type: { in: ['UPLOAD_REQUEST', 'UPLOAD_CHASE', 'EXPIRATION_REMINDER'] }, status: 'SENT' },
          orderBy: { sentAt: 'desc' },
        },
      },
    });

    const scheduled = [];
    const notResponding = [];

    for (const vendor of vendors) {
      const badEmail = isPlaceholderEmail(vendor.email);

      // --- expiration ladder -------------------------------------------------
      const latestApproved = vendor.cois[0] || null;
      const expiration = earliestExpiration(latestApproved);
      if (expiration && settings?.notifyOnExpiration !== false) {
        const days = daysUntil(expiration, now);
        const ordered = [...reminderDays].sort((a, b) => b - a);
        // The next window the COI has not yet been notified for.
        const sentWindows = new Set(
          vendor.notifications
            .filter((n) => n.type === 'EXPIRATION_REMINDER' && n.meta && n.meta.window != null)
            .map((n) => n.meta.window)
        );
        const pending = ordered.filter((w) => !sentWindows.has(w));
        if (pending.length > 0) {
          // The next window whose day has already arrived, else the widest one
          // still ahead of us.
          const target = pending.find((w) => days >= w) ?? pending[pending.length - 1];
          const sendsInDays = Math.max(0, days - target);
          // Step number is this window's place in the ladder, so it can never
          // disagree with the stage label beside it.
          const step = ordered.indexOf(target) + 1;
          scheduled.push({
            vendorId: vendor.id,
            vendorName: vendor.name,
            badEmail,
            sendsAt: new Date(now.getTime() + sendsInDays * 86400000).toISOString().slice(0, 10),
            expiresAt: expiration.toISOString().slice(0, 10),
            what: `${latestApproved ? 'Coverage' : 'Certificate'} expires`,
            step,
            stepCount: ordered.length,
            stage: stageFor(target, reminderDays),
            kind: 'expiration',
          });
        }
      }

      // --- non-responder chase ladder ---------------------------------------
      const lastRequest = vendor.notifications.find((n) => n.type === 'UPLOAD_REQUEST');
      if (lastRequest && settings?.chaseNonResponders !== false && chaseDays.length > 0) {
        const uploadedSince = await prisma.coi.count({
          where: { vendorId: vendor.id, submittedAt: { gt: lastRequest.sentAt } },
        });
        if (uploadedSince === 0) {
          const since = daysSince(lastRequest.sentAt, now);
          const sentSteps = new Set(
            vendor.notifications
              .filter((n) => n.type === 'UPLOAD_CHASE' && n.sentAt >= lastRequest.sentAt && n.meta && n.meta.step != null)
              .map((n) => n.meta.step)
          );
          const nextStep = chaseDays.find((d) => !sentSteps.has(d));
          if (nextStep != null) {
            const sendsInDays = Math.max(0, nextStep - since);
            const isLast = nextStep === chaseDays[chaseDays.length - 1];
            scheduled.push({
              vendorId: vendor.id,
              vendorName: vendor.name,
              badEmail,
              sendsAt: new Date(now.getTime() + sendsInDays * 86400000).toISOString().slice(0, 10),
              expiresAt: null,
              what: `Certificate requested ${since} day${since === 1 ? '' : 's'} ago${isLast ? ' — escalates to you' : ''}`,
              step: chaseDays.indexOf(nextStep) + 1,
              stepCount: chaseDays.length,
              stage: isLast ? { label: 'Final', tone: 'bad' } : { label: `Day ${nextStep}`, tone: 'warn' },
              kind: 'chase',
            });
          } else if (shouldEscalateChase(since, chaseDays)) {
            // Ladder exhausted and still silent — this one needs a person.
            notResponding.push({
              vendorId: vendor.id,
              vendorName: vendor.name,
              email: vendor.email,
              phone: vendor.phone,
              badEmail,
              daysSinceRequest: since,
              chasesSent: sentSteps.size,
            });
          }
        }
      }
    }

    scheduled.sort((a, b) => a.sendsAt.localeCompare(b.sendsAt) || a.vendorName.localeCompare(b.vendorName));
    notResponding.sort((a, b) => b.daysSinceRequest - a.daysSinceRequest);

    // Renewal rate: of the COIs approved in the last 30 days, how many arrived
    // without anyone on the team sending a manual request.
    const since30 = new Date(now.getTime() - 30 * 86400000);
    const [renewed, manualRequests] = await Promise.all([
      prisma.coi.count({ where: { orgId: req.user.orgId, status: 'APPROVED', submittedAt: { gte: since30 } } }),
      prisma.notificationLog.count({
        where: { orgId: req.user.orgId, type: 'MANUAL_CONTACT', sentAt: { gte: since30 } },
      }),
    ]);
    const handsOffPercent = renewed > 0 ? Math.round(((renewed - Math.min(renewed, manualRequests)) / renewed) * 100) : null;

    res.json({
      sendsAt: '8:00 AM',
      reminderDays: [...reminderDays].sort((a, b) => b - a),
      chaseDays,
      chaseEnabled: settings?.chaseNonResponders !== false,
      notifyOnExpiration: settings?.notifyOnExpiration !== false,
      scheduled,
      notResponding,
      handsOffPercent,
      renewedLast30: renewed,
    });
  } catch (err) {
    console.error('Reminders error:', err);
    res.status(500).json({ error: 'Failed to load reminders' });
  }
});

module.exports = router;
