const {
  DEFAULT_ACTIVE_FROM,
  parseIsoDateParam,
  coverageStart,
  coverageEnd,
  coverageOverlapsWindow,
  resolveActivityWindow,
} = require('../src/http/coiCoverageWindow');

describe('parseIsoDateParam', () => {
  it('treats YYYY-MM-DD as UTC start of day', () => {
    const { value } = parseIsoDateParam('2025-03-22');
    expect(value.toISOString()).toBe('2025-03-22T00:00:00.000Z');
  });

  it('treats YYYY-MM-DD as UTC end of day when endOfDay is set', () => {
    const { value } = parseIsoDateParam('2025-03-22', { endOfDay: true });
    expect(value.toISOString()).toBe('2025-03-22T23:59:59.999Z');
  });

  it('rejects impossible calendar dates', () => {
    expect(parseIsoDateParam('2025-02-31').error).toMatch(/valid calendar date/);
  });

  it('accepts a full ISO datetime as-is', () => {
    const { value } = parseIsoDateParam('2025-03-22T14:30:00.000Z');
    expect(value.toISOString()).toBe('2025-03-22T14:30:00.000Z');
  });

  it('returns null for a missing value', () => {
    expect(parseIsoDateParam(undefined).value).toBeNull();
    expect(parseIsoDateParam('').value).toBeNull();
  });
});

describe('coverage start / end', () => {
  const submitted = new Date('2025-01-15T12:00:00.000Z');

  it('starts at submittedAt', () => {
    expect(coverageStart({ submittedAt: submitted }).toISOString()).toBe(submitted.toISOString());
  });

  it('ends at the earliest non-null expiration', () => {
    const end = coverageEnd({
      submittedAt: submitted,
      glExpirationDate: new Date('2026-09-01T00:00:00.000Z'),
      wcExpirationDate: new Date('2025-06-01T00:00:00.000Z'),
      umbExpirationDate: null,
      autoExpirationDate: new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(end.toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });

  it('uses submittedAt as a degenerate end when every expiration is null', () => {
    expect(coverageEnd({ submittedAt: submitted }).toISOString()).toBe(submitted.toISOString());
  });
});

describe('coverageOverlapsWindow', () => {
  const from = new Date('2025-03-22T00:00:00.000Z');
  const to = new Date('2026-03-22T23:59:59.999Z');

  it('includes a COI whose coverage spans the window', () => {
    expect(coverageOverlapsWindow({
      submittedAt: new Date('2024-12-01T00:00:00.000Z'),
      glExpirationDate: new Date('2025-12-01T00:00:00.000Z'),
    }, from, to)).toBe(true);
  });

  it('excludes a COI that expired before activeFrom', () => {
    expect(coverageOverlapsWindow({
      submittedAt: new Date('2024-01-01T00:00:00.000Z'),
      glExpirationDate: new Date('2025-01-01T00:00:00.000Z'),
    }, from, to)).toBe(false);
  });

  it('excludes a COI submitted after activeTo', () => {
    expect(coverageOverlapsWindow({
      submittedAt: new Date('2026-06-01T00:00:00.000Z'),
      glExpirationDate: new Date('2027-01-01T00:00:00.000Z'),
    }, from, to)).toBe(false);
  });

  it('uses the earliest expiration as the end (later lines do not extend coverage)', () => {
    expect(coverageOverlapsWindow({
      submittedAt: new Date('2024-01-01T00:00:00.000Z'),
      glExpirationDate: new Date('2025-01-01T00:00:00.000Z'),
      wcExpirationDate: new Date('2026-12-01T00:00:00.000Z'),
    }, from, to)).toBe(false);
  });

  it('includes a degenerate no-expiry COI only when submittedAt is inside the window', () => {
    expect(coverageOverlapsWindow({
      submittedAt: new Date('2025-06-01T00:00:00.000Z'),
    }, from, to)).toBe(true);
    expect(coverageOverlapsWindow({
      submittedAt: new Date('2024-01-01T00:00:00.000Z'),
    }, from, to)).toBe(false);
  });

  it('is inclusive at both bounds', () => {
    expect(coverageOverlapsWindow({
      submittedAt: from,
      glExpirationDate: from,
    }, from, to)).toBe(true);
    expect(coverageOverlapsWindow({
      submittedAt: to,
      glExpirationDate: new Date('2027-01-01T00:00:00.000Z'),
    }, from, to)).toBe(true);
  });
});

describe('resolveActivityWindow', () => {
  it('defaults activeFrom to 2025-03-22 and activeTo to now', () => {
    const before = Date.now();
    const { activeFrom, activeTo } = resolveActivityWindow({});
    expect(activeFrom.toISOString()).toBe(`${DEFAULT_ACTIVE_FROM}T00:00:00.000Z`);
    expect(activeTo.getTime()).toBeGreaterThanOrEqual(before);
    expect(activeTo.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('rejects inverted windows', () => {
    const result = resolveActivityWindow({ activeFrom: '2026-01-01', activeTo: '2025-01-01' });
    expect(result.error).toMatch(/on or before/);
  });
});
