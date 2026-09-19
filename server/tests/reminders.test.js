const {
  normalizeDayList,
  daysUntil,
  daysSince,
  reminderWindowFor,
  chaseStepFor,
  shouldEscalateChase,
  earliestExpiration,
  DEFAULT_REMINDER_DAYS,
  DEFAULT_CHASE_DAYS,
} = require('../src/services/reminders');
const { isPlaceholderEmail } = require('../src/utils/email');

describe('normalizeDayList', () => {
  it('falls back when the stored JSON is not a usable array', () => {
    expect(normalizeDayList(null, DEFAULT_REMINDER_DAYS)).toEqual([30, 14, 7, 0]);
    expect(normalizeDayList([], DEFAULT_CHASE_DAYS)).toEqual([3, 7, 14]);
    expect(normalizeDayList('30,14', DEFAULT_CHASE_DAYS)).toEqual([3, 7, 14]);
    expect(normalizeDayList(['nope'], DEFAULT_CHASE_DAYS)).toEqual([3, 7, 14]);
  });

  it('coerces numeric strings, drops junk, and de-duplicates', () => {
    expect(normalizeDayList(['30', 14, 14, 'x', 7.9], DEFAULT_REMINDER_DAYS)).toEqual([30, 14, 7]);
  });
});

describe('daysUntil / daysSince', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('counts whole days forward and backward', () => {
    expect(daysUntil(new Date('2026-06-08T12:00:00Z'), now)).toBe(7);
    expect(daysUntil(new Date('2026-05-25T12:00:00Z'), now)).toBe(-7);
    expect(daysSince(new Date('2026-05-25T12:00:00Z'), now)).toBe(7);
    expect(daysSince(new Date('2026-06-01T00:00:00Z'), now)).toBe(0);
  });
});

describe('reminderWindowFor', () => {
  const windows = [30, 14, 7, 0];

  it('returns null while expiration is beyond the widest window', () => {
    expect(reminderWindowFor(45, windows)).toBeNull();
    expect(reminderWindowFor(31, windows)).toBeNull();
  });

  it('fires the 30-day window on any day inside it, not just day 30', () => {
    expect(reminderWindowFor(30, windows)).toBe(30);
    expect(reminderWindowFor(27, windows)).toBe(30);
    expect(reminderWindowFor(15, windows)).toBe(30);
  });

  it('tightens to the narrowest window already crossed', () => {
    expect(reminderWindowFor(14, windows)).toBe(14);
    expect(reminderWindowFor(8, windows)).toBe(14);
    expect(reminderWindowFor(7, windows)).toBe(7);
    expect(reminderWindowFor(1, windows)).toBe(7);
  });

  it('puts expiration day and anything already expired in the 0 window', () => {
    expect(reminderWindowFor(0, windows)).toBe(0);
    expect(reminderWindowFor(-1, windows)).toBe(0);
    expect(reminderWindowFor(-400, windows)).toBe(0);
  });

  it('honours a custom, unsorted window list', () => {
    expect(reminderWindowFor(40, [60, 10])).toBe(60);
    expect(reminderWindowFor(9, [60, 10])).toBe(10);
    expect(reminderWindowFor(61, [60, 10])).toBeNull();
  });
});

describe('chaseStepFor', () => {
  const steps = [3, 7, 14];

  it('stays quiet until the first follow-up is due', () => {
    expect(chaseStepFor(0, steps)).toBeNull();
    expect(chaseStepFor(2, steps)).toBeNull();
  });

  it('advances to the latest step whose day has arrived', () => {
    expect(chaseStepFor(3, steps)).toBe(3);
    expect(chaseStepFor(6, steps)).toBe(3);
    expect(chaseStepFor(7, steps)).toBe(7);
    expect(chaseStepFor(13, steps)).toBe(7);
    expect(chaseStepFor(14, steps)).toBe(14);
    expect(chaseStepFor(90, steps)).toBe(14);
  });
});

describe('shouldEscalateChase', () => {
  const steps = [3, 7, 14];

  it('only escalates once the whole ladder has been climbed', () => {
    expect(shouldEscalateChase(13, steps)).toBe(false);
    expect(shouldEscalateChase(14, steps)).toBe(false);
    expect(shouldEscalateChase(15, steps)).toBe(true);
  });

  it('never escalates when chasing is configured off', () => {
    expect(shouldEscalateChase(500, [])).toBe(false);
  });
});

describe('earliestExpiration', () => {
  it('picks the soonest coverage date on the COI', () => {
    const coi = {
      glExpirationDate: new Date('2026-09-01T00:00:00Z'),
      wcExpirationDate: new Date('2026-07-15T00:00:00Z'),
      umbExpirationDate: null,
      autoExpirationDate: new Date('2026-12-01T00:00:00Z'),
    };
    expect(earliestExpiration(coi).toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });

  it('returns null for a missing COI or one with no dates', () => {
    expect(earliestExpiration(null)).toBeNull();
    expect(earliestExpiration({})).toBeNull();
  });
});

describe('isPlaceholderEmail', () => {
  it('rejects the synthetic addresses the Airtable import creates', () => {
    expect(isPlaceholderEmail('acme-plumbing-recXYZ@no-email.proofcoi.local')).toBe(true);
  });

  it('rejects reserved domains and malformed addresses', () => {
    expect(isPlaceholderEmail('someone@example.com')).toBe(true);
    expect(isPlaceholderEmail('someone@host.invalid')).toBe(true);
    expect(isPlaceholderEmail('someone@box.test')).toBe(true);
    expect(isPlaceholderEmail('not-an-email')).toBe(true);
    expect(isPlaceholderEmail('')).toBe(true);
    expect(isPlaceholderEmail(null)).toBe(true);
  });

  it('accepts ordinary deliverable addresses', () => {
    expect(isPlaceholderEmail('billing@acmeplumbing.com')).toBe(false);
    expect(isPlaceholderEmail('Jane.Doe@Sub.Example-Co.co.uk')).toBe(false);
  });
});
