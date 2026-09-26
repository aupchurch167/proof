// Per-coverage verdicts for the chips on the vendor list, vendor detail, and
// the review pane. Pass/fail goes through complianceRules so the chips and the
// vendor badge share one rule.

const { DEFAULT_EXPIRING_WINDOW_DAYS, expiringWindowDays, verdictForLine } = require('./complianceRules');

// Default warn window when the org has not saved one. The live window is
// OrganizationSettings.expiringWindowDays (0 turns the Expiring verdict off).
const EXPIRING_SOON_DAYS = DEFAULT_EXPIRING_WINDOW_DAYS;

// The four lines, with the COI column names and the settings key that carries
// each one's required minimum.
const COVERAGE_LINES = [
  { key: 'gl', chip: 'GL', label: 'General liability', short: 'General liability', note: 'Per-occurrence limit', amount: 'glCoverageAmount', expiration: 'glExpirationDate', policy: 'glPolicyNumber', setting: 'minGeneralLiability' },
  { key: 'auto', chip: 'Auto', label: 'Auto liability', short: 'Auto', note: 'Combined single limit', amount: 'autoCoverageAmount', expiration: 'autoExpirationDate', policy: 'autoPolicyNumber', setting: 'minAutomobile' },
  { key: 'wc', chip: 'WC', label: "Workers' compensation", short: "Workers' comp", note: 'Each accident', amount: 'wcCoverageAmount', expiration: 'wcExpirationDate', policy: 'wcPolicyNumber', setting: 'minWorkersComp' },
  { key: 'umb', chip: 'Umb', label: 'Umbrella / excess', short: 'Umbrella', note: 'Each occurrence', amount: 'umbCoverageAmount', expiration: 'umbExpirationDate', policy: 'umbPolicyNumber', setting: 'minUmbrella' },
];

// Coverage amounts live in cents; the contract and the UI talk whole dollars.
function centsToDollars(cents) {
  return cents == null ? null : Math.round(cents / 100);
}

/**
 * Verdict for one coverage line. Same rule as evaluateCompliance: a minimum
 * of 0 is not required, and the expiring verdict uses the saved warn window.
 */
function verdictFor(line, coi, settings, now) {
  return verdictForLine({
    amount: coi ? coi[line.amount] : null,
    expiration: coi ? coi[line.expiration] : null,
    policy: coi ? coi[line.policy] : null,
    minimum: settings ? settings[line.setting] : null,
    windowDays: expiringWindowDays(settings),
    now,
  });
}

// Verdict -> the chip/pill tone the UI paints it with.
const VERDICT_TONE = {
  meets: 'ok',
  expiring: 'warn',
  missing: 'bad',
  under: 'bad',
  expired: 'bad',
  skipped: 'none',
};

/**
 * All four coverage lines for a vendor's latest approved COI.
 * Returns one entry per line, always in display order, so the client can render
 * a fixed set of chips without worrying about which lines exist.
 */
function coverageFor(coi, settings, { now = new Date() } = {}) {
  return COVERAGE_LINES.map((line) => {
    const { verdict, required } = verdictFor(line, coi, settings, now);
    const expiration = coi ? coi[line.expiration] : null;
    return {
      key: line.key,
      chip: line.chip,
      label: line.label,
      short: line.short,
      note: line.note,
      verdict,
      tone: VERDICT_TONE[verdict],
      limit: coi ? centsToDollars(coi[line.amount]) : null,
      required: centsToDollars(required),
      expiresAt: expiration ? new Date(expiration).toISOString().slice(0, 10) : null,
      policyNumber: coi ? coi[line.policy] || null : null,
    };
  });
}

const FAILURE_HOW = { missing: 'missing', under: 'under limit', expired: 'expired' };

// Every coverage line that failed, in chip order. The vendor page lists these
// next to a holder mismatch instead of keeping only the first one.
function coverageFailureReasons(coverages) {
  return (coverages || [])
    .filter((c) => FAILURE_HOW[c.verdict])
    .map((c) => `${c.label} ${FAILURE_HOW[c.verdict]}`);
}

// The one-line reason behind a vendor's status ("Workers' comp missing").
function coverageReason(coverages) {
  const failures = coverageFailureReasons(coverages);
  if (failures.length) return failures[0];
  const soon = (coverages || []).find((c) => c.verdict === 'expiring');
  if (soon) return `${soon.label} expires ${soon.expiresAt}`;
  return null;
}

module.exports = {
  COVERAGE_LINES,
  EXPIRING_SOON_DAYS,
  VERDICT_TONE,
  coverageFor,
  coverageReason,
  coverageFailureReasons,
  centsToDollars,
};
