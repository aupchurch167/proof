// Coverage-activity window for historical approved COIs.
//
// Include a Coi when status === APPROVED, pdfPath is set, and coverage
// overlaps [activeFrom, activeTo]:
//
//   start = submittedAt
//     Best available start. The Coi model has no separate policy effective date.
//   end   = earliest non-null among
//             glExpirationDate / wcExpirationDate / umbExpirationDate / autoExpirationDate
//     If every expiration is null, use submittedAt as a degenerate end so we
//     do not invent an expiry.
//   overlap: start <= activeTo AND end >= activeFrom
//
// Default window (MAC's audit period): 2025-03-22 → now.

const DEFAULT_ACTIVE_FROM = '2025-03-22';

const EXPIRATION_FIELDS = [
  'glExpirationDate',
  'wcExpirationDate',
  'umbExpirationDate',
  'autoExpirationDate',
];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an ISO date or datetime query param.
 * Date-only values (YYYY-MM-DD) are treated as UTC calendar days:
 * start-of-day by default, or end-of-day when `endOfDay` is set so the
 * inclusive window covers the whole last day.
 * Returns null when the value is missing/empty, or { error } when invalid.
 */
function parseIsoDateParam(raw, { endOfDay = false } = {}) {
  if (raw == null || raw === '') return { value: null };
  if (typeof raw !== 'string') return { error: 'must be an ISO date (YYYY-MM-DD)' };

  const dateOnly = raw.match(DATE_ONLY);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const utc = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    const dt = new Date(utc);
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
      return { error: 'must be a valid calendar date (YYYY-MM-DD)' };
    }
    return { value: dt };
  }

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) {
    return { error: 'must be an ISO date (YYYY-MM-DD) or ISO datetime' };
  }
  return { value: dt };
}

function coverageStart(coi) {
  if (!coi || !coi.submittedAt) return null;
  const d = new Date(coi.submittedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Coverage end: earliest non-null policy expiration, or submittedAt when none
 * are set (degenerate — we do not invent an expiry).
 */
function coverageEnd(coi) {
  if (!coi) return null;
  const dates = EXPIRATION_FIELDS
    .map((field) => coi[field])
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length === 0) return coverageStart(coi);
  return dates.reduce((min, d) => (d < min ? d : min), dates[0]);
}

function coverageOverlapsWindow(coi, activeFrom, activeTo) {
  const start = coverageStart(coi);
  const end = coverageEnd(coi);
  if (!start || !end) return false;
  return start.getTime() <= activeTo.getTime() && end.getTime() >= activeFrom.getTime();
}

/**
 * Prisma `where` fragment for the overlap rule. Equivalent to
 * coverageOverlapsWindow: start <= activeTo AND end >= activeFrom.
 *
 * end >= activeFrom when expirations exist means the earliest (min) expiration
 * is >= activeFrom, i.e. every non-null expiration is >= activeFrom.
 */
function coverageOverlapWhere(activeFrom, activeTo) {
  return {
    AND: [
      { submittedAt: { lte: activeTo } },
      {
        OR: [
          {
            AND: [
              ...EXPIRATION_FIELDS.map((field) => ({ [field]: null })),
              { submittedAt: { gte: activeFrom } },
            ],
          },
          {
            AND: [
              ...EXPIRATION_FIELDS.map((field) => ({
                OR: [{ [field]: null }, { [field]: { gte: activeFrom } }],
              })),
              { OR: EXPIRATION_FIELDS.map((field) => ({ [field]: { not: null } })) },
            ],
          },
        ],
      },
    ],
  };
}

function resolveActivityWindow(query = {}) {
  const fromRaw = query.activeFrom == null || query.activeFrom === ''
    ? DEFAULT_ACTIVE_FROM
    : query.activeFrom;
  const parsedFrom = parseIsoDateParam(fromRaw, { endOfDay: false });
  if (parsedFrom.error) {
    return { error: `activeFrom ${parsedFrom.error}`, details: { activeFrom: fromRaw } };
  }

  let activeTo;
  if (query.activeTo == null || query.activeTo === '') {
    activeTo = new Date();
  } else {
    const parsedTo = parseIsoDateParam(query.activeTo, { endOfDay: true });
    if (parsedTo.error) {
      return { error: `activeTo ${parsedTo.error}`, details: { activeTo: query.activeTo } };
    }
    activeTo = parsedTo.value;
  }

  const activeFrom = parsedFrom.value;
  if (activeFrom.getTime() > activeTo.getTime()) {
    return {
      error: 'activeFrom must be on or before activeTo',
      details: { activeFrom: fromRaw, activeTo: query.activeTo || null },
    };
  }

  return { activeFrom, activeTo };
}

module.exports = {
  DEFAULT_ACTIVE_FROM,
  EXPIRATION_FIELDS,
  parseIsoDateParam,
  coverageStart,
  coverageEnd,
  coverageOverlapsWindow,
  coverageOverlapWhere,
  resolveActivityWindow,
};
