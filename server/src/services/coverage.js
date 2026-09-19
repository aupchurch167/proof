// Per-coverage verdicts — the single definition behind the coverage chips on
// the vendor list, the coverage cards on vendor detail, and the review pane.
//
// checkCompliance() answers "is this COI acceptable overall". The UI needs a
// finer answer: for each of the four coverage lines, does it meet the org's
// requirement, is it about to lapse, is it short, or is it not required at all.

const EXPIRING_SOON_DAYS = 30;

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

function daysUntil(date, now) {
  return Math.ceil((new Date(date).getTime() - now.getTime()) / 86400000);
}

/**
 * Verdict for one coverage line.
 *
 * A required line with no amount on file is `missing`; one below the org's
 * minimum is `under`. An expired line reads `expired` regardless of its limit,
 * because the limit is moot once the policy has lapsed. A line the org doesn't
 * require is `skipped` and never counts against the vendor.
 */
function verdictFor(line, coi, settings, now) {
  const required = settings ? settings[line.setting] : null;
  if (!required || required <= 0) {
    return { verdict: 'skipped', required: null };
  }
  if (!coi) return { verdict: 'missing', required };

  const amount = coi[line.amount];
  const expiration = coi[line.expiration];

  if (amount == null && !expiration && !coi[line.policy]) {
    return { verdict: 'missing', required };
  }
  if (expiration && daysUntil(expiration, now) < 0) {
    return { verdict: 'expired', required };
  }
  if (amount == null || amount < required) {
    return { verdict: 'under', required };
  }
  if (expiration && daysUntil(expiration, now) <= EXPIRING_SOON_DAYS) {
    return { verdict: 'expiring', required };
  }
  return { verdict: 'meets', required };
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

// The one-line reason behind a vendor's status pill ("Gap · Workers' comp
// missing"), used on the vendor detail header and in the dashboard queue.
function coverageReason(coverages) {
  const problem = coverages.find((c) => c.verdict === 'missing' || c.verdict === 'under' || c.verdict === 'expired');
  if (problem) {
    const how = { missing: 'missing', under: 'under limit', expired: 'expired' }[problem.verdict];
    return `${problem.label} ${how}`;
  }
  const soon = coverages.find((c) => c.verdict === 'expiring');
  if (soon) return `${soon.label} expires ${soon.expiresAt}`;
  return null;
}

module.exports = {
  COVERAGE_LINES,
  EXPIRING_SOON_DAYS,
  VERDICT_TONE,
  coverageFor,
  coverageReason,
  centsToDollars,
};
