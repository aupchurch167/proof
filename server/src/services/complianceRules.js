// Single compliance definition for the vendor badge, coverage chips, the
// dashboard queue, the weekly summary, and API coverage lines. Callers must
// not keep a second copy of "is this line required?", "does the holder
// match?", or "is this date inside the warn window?".

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

// Spelling variants of the same legal suffix compare as the same token.
// The suffix stays part of the name: "Acme LLC" does not equal "Acme".
const SUFFIX_CANON = {
  llc: 'llc',
  inc: 'inc',
  incorporated: 'inc',
  co: 'co',
  company: 'co',
  corp: 'corp',
  corporation: 'corp',
};

const CANONICAL_SUFFIXES = new Set(Object.values(SUFFIX_CANON));

// Lowercase, collapse whitespace, drop punctuation, and spell suffixes the
// same way on both sides. "Acme Construction, LLC" and "Acme Construction LLC"
// become the same string. A bare suffix or a one- or two-character fragment
// is not a name and never matches.
function normalizePartyName(value) {
  if (value == null) return '';
  const rough = String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const tokens = [];
  for (let i = 0; i < rough.length;) {
    if (rough[i].length === 1) {
      let j = i;
      let letters = '';
      while (j < rough.length && rough[j].length === 1) {
        letters += rough[j];
        j += 1;
      }
      if (j > i + 1) {
        tokens.push(SUFFIX_CANON[letters] || letters);
        i = j;
        continue;
      }
    }
    tokens.push(SUFFIX_CANON[rough[i]] || rough[i]);
    i += 1;
  }
  return tokens.join(' ');
}

function isBareOrFragment(normalized) {
  if (!normalized || normalized.length < 3) return true;
  return normalized.split(' ').every((token) => CANONICAL_SUFFIXES.has(token));
}

function holderMatches(holderName, orgName) {
  const holderNorm = normalizePartyName(holderName);
  const orgNorm = normalizePartyName(orgName);
  if (isBareOrFragment(holderNorm) || isBareOrFragment(orgNorm)) return false;
  return holderNorm === orgNorm;
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

// One-line reason for a failing evaluation, shared by the dashboard queue and
// the weekly email so they describe the same failure the badge used.
function complianceIssue(result) {
  if (!result) return null;
  const holderMissing = result.flags.find(
    (flag) => flag.type === 'MISSING' && flag.field === 'certificateHolderName'
  );
  if (holderMissing) return 'Certificate holder missing';
  const mismatch = result.flags.find((flag) => flag.type === 'ADDITIONALLY_INSURED_MISMATCH');
  if (mismatch) return 'Certificate holder does not match';
  const problem = result.lines.find(
    (line) => line.verdict === 'missing' || line.verdict === 'under' || line.verdict === 'expired'
  );
  if (problem) {
    const how = { missing: 'missing', under: 'under limit', expired: 'expired' }[problem.verdict];
    return `${problem.label} ${how}`;
  }
  return null;
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
  normalizePartyName,
  holderMatches,
  verdictForLine,
  evaluateCompliance,
  complianceIssue,
  earliestRequiredExpiration,
};
