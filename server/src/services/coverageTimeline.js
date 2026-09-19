// "Who was covered during the audit period" — the computation behind the Audit
// log's coverage panel.
//
// A vendor's coverage for one line is the union of its approved certificates'
// intervals for that line: a certificate covers from the day it was submitted
// until that line's expiration date. A day counts as covered only if EVERY
// selected coverage line is covered that day, which is what an insurance
// auditor actually asks. Days outside the vendor's active window are neither
// covered nor a gap — they're simply not their responsibility.

const { COVERAGE_LINES } = require('./coverage');

const DAY = 86400000;

const LINE_BY_KEY = Object.fromEntries(COVERAGE_LINES.map((l) => [l.key, l]));

function startOfDay(value) {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Build each vendor's covered/gap intervals for a line from its approved COIs.
 * Returns [[startMs, endMs], ...] — end exclusive.
 */
function intervalsFor(cois, line) {
  return cois
    .map((coi) => {
      const expiration = coi[line.expiration];
      if (!expiration) return null;
      const from = startOfDay(coi.submittedAt);
      const to = startOfDay(expiration);
      return to > from ? [from, to] : null;
    })
    .filter(Boolean);
}

function coveredAt(intervals, ms) {
  return intervals.some(([a, b]) => a <= ms && ms < b);
}

/**
 * @param {Array} vendors  Each with { id, name, trade, createdAt, deletedAt, cois: [approved] }
 * @param {string[]} keys  Coverage keys to require ('gl','auto','wc','umb')
 */
function buildTimeline(vendors, { from, to, keys }) {
  const f = startOfDay(from);
  const t = startOfDay(to);
  if (!(t > f)) return { rows: [], days: 0 };
  const span = t - f;

  const rows = [];

  for (const vendor of vendors) {
    // Active window: from when the vendor was added until it was removed.
    const activeStart = Math.max(f, startOfDay(vendor.createdAt));
    const activeEnd = Math.min(t, vendor.deletedAt ? startOfDay(vendor.deletedAt) : t);
    if (activeEnd <= activeStart) continue;

    // Only require lines the vendor actually carries when "all" is selected —
    // a line the org doesn't require of them can't put them in a gap.
    const lineKeys = keys.filter((k) => LINE_BY_KEY[k]);
    const intervalsByKey = {};
    for (const key of lineKeys) {
      intervalsByKey[key] = intervalsFor(vendor.cois, LINE_BY_KEY[key]);
    }
    const required = lineKeys.filter((k) => intervalsByKey[k].length > 0 || keys.length === 1);
    if (keys.length === 1 && intervalsByKey[keys[0]].length === 0) {
      // Asked about one specific line the vendor has never carried.
      required.push(keys[0]);
    }

    // Cut the window at every interval boundary, then classify each slice once.
    const cuts = new Set([activeStart, activeEnd]);
    for (const key of required) {
      for (const [a, b] of intervalsByKey[key]) {
        if (a > activeStart && a < activeEnd) cuts.add(a);
        if (b > activeStart && b < activeEnd) cuts.add(b);
      }
    }
    const points = [...cuts].sort((a, b) => a - b);

    const segments = [];
    let gapDays = 0;
    let firstGap = null;

    if (activeStart > f) {
      segments.push({ fraction: (activeStart - f) / span, state: 'inactive', from: f, to: activeStart });
    }
    for (let i = 0; i < points.length - 1; i++) {
      const s = points[i];
      const e = points[i + 1];
      const mid = (s + e) / 2;
      const covered = required.length > 0 && required.every((key) => coveredAt(intervalsByKey[key], mid));
      if (!covered) {
        gapDays += Math.round((e - s) / DAY);
        if (!firstGap) firstGap = [s, e];
      }
      segments.push({ fraction: (e - s) / span, state: covered ? 'covered' : 'gap', from: s, to: e });
    }
    if (activeEnd < t) {
      segments.push({ fraction: (t - activeEnd) / span, state: 'inactive', from: activeEnd, to: t });
    }

    const activeDays = Math.round((activeEnd - activeStart) / DAY);
    rows.push({
      id: vendor.id,
      name: vendor.name,
      trade: vendor.trade,
      activeDays,
      gapDays,
      full: gapDays === 0,
      firstGap: firstGap ? { from: new Date(firstGap[0]).toISOString().slice(0, 10), to: new Date(firstGap[1]).toISOString().slice(0, 10) } : null,
      segments: segments.map((s) => ({
        ...s,
        from: new Date(s.from).toISOString().slice(0, 10),
        to: new Date(s.to).toISOString().slice(0, 10),
      })),
    });
  }

  // Worst first — the rows an auditor will ask about.
  rows.sort((a, b) => b.gapDays - a.gapDays || a.name.localeCompare(b.name));
  return { rows, days: Math.round(span / DAY) };
}

module.exports = { buildTimeline };
