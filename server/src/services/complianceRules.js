// Single compliance definition for the vendor badge, coverage chips, the
// compliance overview, the weekly summary's expiring bucket, and API coverage
// status. Callers must not keep a second copy of "is this line required?",
// "does the holder match?", or "is this date inside the warn window?".

const { daysUntil } = require('./reminders');

// Used only when an org has not saved a window. `0` is a real setting and
// means "do not mark EXPIRING_SOON".
const DEFAULT_EXPIRING_WINDOW_DAYS = 30;

// Amount / expiration / policy columns and the settings key for each minimum.
// Order matches the flags checkCompliance has always emitted.
const COVERAGE_CHECKS = [
  { key: 'gl', amount: 'glCoverageAmount', expiration: 'glExpirationDate', policy: 'glPolicyNumber', setting: 'minGeneralLiability', label: 'General Liability' },
  { key: 'wc', amount: 'wcCoverageAmount', expiration: 'wcExpirationDate', policy: 'wcPolicyNumber', setting: 'minWorkersComp', label: 'Workers Compensation' },
  { key: 'umb', amount: 'umbCoverageAmount', expiration: 'umbExpirationDate', policy: 'umbPolicyNumber', setting: 'minUmbrella', label: 'Umbrella' },
  { key: 'auto', amount: 'autoCoverageAmount', expiration: 'autoExpirationDate', policy: 'autoPolicyNumber', setting: 'minAutomobile', label: 'Automobile' },
];

function expiringWindowDays(settings) {
  if (settings == null || settings.expiringWindowDays == null || settings.expiringWindowDays === '') {
    return DEFAULT_EXPIRING_WINDOW_DAYS;
  }
  const n = Number(settings.expiringWindowDays);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_EXPIRING_WINDOW_DAYS;
  return Math.trunc(n);
}

// A stored minimum of 0 (or anything not above zero) means the line is off.
function lineIsRequired(minimum) {
  const n = Number(minimum);
  return Number.isFinite(n) && n > 0;
}

function isExpiredDate(date, now) {
  if (date == null || date === '') return false;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return false;
  return daysUntil(parsed, now) < 0;
}

// `windowDays` of 0 never matches. A date already past is not "expiring".
function isExpiringSoon(date, windowDays, now) {
  if (!(Number(windowDays) > 0) || date == null || date === '') return false;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return false;
  const days = daysUntil(parsed, now);
  return days >= 0 && days <= windowDays;
}

function holderMatches(holderName, orgName) {
  if (holderName == null || orgName == null) return false;
  const holderNorm = String(holderName).toLowerCase().trim();
  const orgNorm = String(orgName).toLowerCase().trim();
  if (!holderNorm || !orgNorm) return false;
  return holderNorm.includes(orgNorm) || orgNorm.includes(holderNorm);
}

/**
 * Verdict for one coverage line. `skipped` never counts against the vendor.
 * A required line with nothing on file is `missing`; one below the minimum is
 * `under`. An expired required line is `expired` even when the limit is ample.
 */
function verdictForLine({ amount, expiration, policy, minimum, windowDays, now }) {
  if (!lineIsRequired(minimum)) return { verdict: 'skipped', required: null };
  const required = Number(minimum);
  if (amount == null && !expiration && !policy) return { verdict: 'missing', required };
  if (expiration && isExpiredDate(expiration, now)) return { verdict: 'expired', required };
  if (amount == null || amount < required) return { verdict: 'under', required };
  if (isExpiringSoon(expiration, windowDays, now)) return { verdict: 'expiring', required };
  return { verdict: 'meets', required };
}

function dollars(cents) {
  return (cents / 100).toLocaleString();
}

/**
 * Evaluate one certificate against the org's requirement settings.
 *
 * `status` is the approved-certificate badge (COMPLIANT, EXPIRING_SOON,
 * EXPIRED, NON_COMPLIANT). Pending / no-COI are decided by the caller.
 * A skipped line does not produce a flag and cannot make status NON_COMPLIANT.
 * Holder mismatch and a blank holder fail only when requireHolderMatch is on
 * (the column default). A warn window of 0 never yields EXPIRING_SOON.
 */
function evaluateCompliance(extractedData, settings, orgName, { now = new Date() } = {}) {
  const data = extractedData || {};
  const windowDays = expiringWindowDays(settings);
  // Missing settings still follow the column default: the switch is on.
  const requireHolder = settings?.requireHolderMatch !== false;
  const flags = [];
  const lines = [];

  for (const check of COVERAGE_CHECKS) {
    const minimum = settings ? settings[check.setting] : null;
    const amount = data[check.amount];
    const expiration = data[check.expiration];
    const policy = data[check.policy];
    const { verdict, required } = verdictForLine({
      amount, expiration, policy, minimum, windowDays, now,
    });
    lines.push({
      key: check.key,
      field: check.amount,
      expirationField: check.expiration,
      label: check.label,
      verdict,
      required,
    });

    if (verdict === 'missing') {
      flags.push({
        type: 'MISSING',
        field: check.amount,
        label: check.label,
        message: `${check.label} coverage not found`,
      });
    } else if (verdict === 'under') {
      flags.push({
        type: 'INSUFFICIENT',
        field: check.amount,
        label: check.label,
        required,
        actual: amount == null ? null : amount,
        message: amount == null
          ? `${check.label} coverage is below minimum ($${dollars(required)})`
          : `${check.label} coverage ($${dollars(amount)}) is below minimum ($${dollars(required)})`,
      });
    } else if (verdict === 'expired') {
      flags.push({
        type: 'EXPIRED',
        field: check.expiration,
        label: check.label,
        expirationDate: expiration,
        message: `${check.label} coverage expired on ${expiration}`,
      });
    }
  }

  if (requireHolder) {
    const holder = data.certificateHolderName;
    const blank = holder == null || String(holder).trim() === '';
    if (blank) {
      flags.push({
        type: 'MISSING',
        field: 'certificateHolderName',
        label: 'Certificate holder',
        message: 'Certificate holder name is missing',
      });
    } else if (!holderMatches(holder, orgName)) {
      flags.push({
        type: 'ADDITIONALLY_INSURED_MISMATCH',
        field: 'certificateHolderName',
        label: 'Additionally Insured',
        expected: orgName,
        actual: holder,
        message: `Certificate holder "${holder}" does not match organization "${orgName}"`,
      });
    }
  }

  const active = lines.filter((line) => line.verdict !== 'skipped');
  const holderFail = flags.some((flag) =>
    flag.type === 'ADDITIONALLY_INSURED_MISMATCH'
    || (flag.type === 'MISSING' && flag.field === 'certificateHolderName'));

  let status = 'COMPLIANT';
  if (holderFail || active.some((line) => line.verdict === 'missing' || line.verdict === 'under')) {
    status = 'NON_COMPLIANT';
  } else if (active.some((line) => line.verdict === 'expired')) {
    status = 'EXPIRED';
  } else if (active.some((line) => line.verdict === 'expiring')) {
    status = 'EXPIRING_SOON';
  }

  return { windowDays, requireHolder, flags, lines, status };
}

// Earliest expiration among lines the org actually requires. Optional lines
// (minimum 0) do not pull a vendor into the expiring or expired bucket.
function earliestRequiredExpiration(coi, settings) {
  if (!coi) return null;
  const dates = COVERAGE_CHECKS
    .filter((check) => lineIsRequired(settings ? settings[check.setting] : null))
    .map((check) => coi[check.expiration])
    .filter((date) => date != null && date !== '' && !Number.isNaN(new Date(date).getTime()))
    .map((date) => new Date(date));
  if (dates.length === 0) return null;
  return dates.reduce((min, date) => (date < min ? date : min), dates[0]);
}

module.exports = {
  DEFAULT_EXPIRING_WINDOW_DAYS,
  COVERAGE_CHECKS,
  daysUntil,
  expiringWindowDays,
  lineIsRequired,
  isExpiredDate,
  isExpiringSoon,
  holderMatches,
  verdictForLine,
  evaluateCompliance,
  earliestRequiredExpiration,
};
