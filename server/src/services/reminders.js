/**
 * Window math shared by the expiration reminder and non-responder chase jobs.
 *
 * Both jobs run daily and both used to depend on an exact day match, which
 * meant a single missed run (deploy, outage, a vendor added mid-window) lost
 * the notification entirely. These helpers instead pick the *window* a vendor
 * currently falls in; the callers dedupe on that window so each one fires
 * exactly once.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_REMINDER_DAYS = [30, 14, 7, 0];
const DEFAULT_CHASE_DAYS = [3, 7, 14];

// Settings hold these as free-form JSON, so anything can be in there.
function normalizeDayList(value, fallback) {
  const raw = Array.isArray(value) ? value : [];
  const nums = raw
    .map((n) => (typeof n === 'string' ? Number(n.trim()) : Number(n)))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
  const unique = [...new Set(nums)];
  return unique.length > 0 ? unique : [...fallback];
}

// Positive while the date is in the future; 0 on the day it lands.
function daysUntil(date, now) {
  return Math.ceil((new Date(date).getTime() - now.getTime()) / DAY_MS);
}

function daysSince(date, now) {
  return Math.floor((now.getTime() - new Date(date).getTime()) / DAY_MS);
}

/**
 * The reminder window a COI currently sits in: the tightest configured
 * threshold it has already crossed. With [30, 14, 7, 0], 27 days out is the
 * "30" window, 5 days out is the "7" window, and anything already expired is
 * the "0" window. Returns null when expiration is still further out than the
 * widest threshold.
 */
function reminderWindowFor(days, reminderDays) {
  const crossed = reminderDays.filter((d) => days <= d);
  return crossed.length > 0 ? Math.min(...crossed) : null;
}

/**
 * The chase step a vendor is due for: the latest configured follow-up whose
 * day has arrived. With [3, 7, 14], day 4 is step 3 and day 20 is step 14.
 * Returns null before the first follow-up is due.
 */
function chaseStepFor(days, chaseDays) {
  const due = chaseDays.filter((d) => days >= d);
  return due.length > 0 ? Math.max(...due) : null;
}

// Every follow-up has been sent and the vendor still hasn't uploaded.
function shouldEscalateChase(days, chaseDays) {
  if (chaseDays.length === 0) return false;
  return days > Math.max(...chaseDays);
}

// Earliest of the four coverage expirations on a COI, or null if none parsed.
function earliestExpiration(coi) {
  if (!coi) return null;
  const dates = [
    coi.glExpirationDate,
    coi.wcExpirationDate,
    coi.umbExpirationDate,
    coi.autoExpirationDate,
  ]
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));

  if (dates.length === 0) return null;
  return dates.reduce((min, d) => (d < min ? d : min), dates[0]);
}

module.exports = {
  DAY_MS,
  DEFAULT_REMINDER_DAYS,
  DEFAULT_CHASE_DAYS,
  normalizeDayList,
  daysUntil,
  daysSince,
  reminderWindowFor,
  chaseStepFor,
  shouldEscalateChase,
  earliestExpiration,
};
