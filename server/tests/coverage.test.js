const { coverageFor, coverageReason } = require('../src/services/coverage');
const { buildTimeline } = require('../src/services/coverageTimeline');

// $1M GL, $500K WC, $1M auto, umbrella not required.
const SETTINGS = {
  minGeneralLiability: 100000000,
  minAutomobile: 100000000,
  minWorkersComp: 50000000,
  minUmbrella: 0,
};

const NOW = new Date('2026-09-19T00:00:00Z');
const at = (iso) => new Date(`${iso}T00:00:00Z`);
const verdicts = (coi, settings = SETTINGS) =>
  Object.fromEntries(coverageFor(coi, settings, { now: NOW }).map((c) => [c.key, c.verdict]));

describe('coverage verdicts', () => {
  it('passes a policy that clears the minimum and is not near expiry', () => {
    const v = verdicts({
      glCoverageAmount: 200000000, glExpirationDate: at('2027-03-01'),
      autoCoverageAmount: 100000000, autoExpirationDate: at('2027-03-01'),
      wcCoverageAmount: 50000000, wcExpirationDate: at('2027-03-01'),
    });
    expect(v).toEqual({ gl: 'meets', auto: 'meets', wc: 'meets', umb: 'skipped' });
  });

  it('calls a policy under the org minimum "under", not "meets"', () => {
    const v = verdicts({ glCoverageAmount: 50000000, glExpirationDate: at('2027-03-01') });
    expect(v.gl).toBe('under');
  });

  it('flags a line inside the 30-day window as expiring', () => {
    const v = verdicts({ glCoverageAmount: 200000000, glExpirationDate: at('2026-10-05') });
    expect(v.gl).toBe('expiring');
  });

  it('reports an expired line as expired even when the limit is ample', () => {
    const v = verdicts({ glCoverageAmount: 500000000, glExpirationDate: at('2026-08-01') });
    expect(v.gl).toBe('expired');
  });

  it('treats a line with nothing on file as missing', () => {
    expect(verdicts({}).gl).toBe('missing');
    expect(verdicts(null).wc).toBe('missing');
  });

  it('never holds a coverage the org does not require against a vendor', () => {
    expect(verdicts({}).umb).toBe('skipped');
  });

  it('summarizes the first real problem for the status pill', () => {
    const coverages = coverageFor(
      { glCoverageAmount: 200000000, glExpirationDate: at('2027-03-01'), autoCoverageAmount: 100000000, autoExpirationDate: at('2027-03-01') },
      SETTINGS,
      { now: NOW }
    );
    expect(coverageReason(coverages)).toBe("Workers' compensation missing");
  });

  it('has no complaint when every required line meets', () => {
    const coverages = coverageFor(
      {
        glCoverageAmount: 200000000, glExpirationDate: at('2027-03-01'),
        autoCoverageAmount: 100000000, autoExpirationDate: at('2027-03-01'),
        wcCoverageAmount: 50000000, wcExpirationDate: at('2027-03-01'),
      },
      SETTINGS,
      { now: NOW }
    );
    expect(coverageReason(coverages)).toBeNull();
  });
});

describe('coverage timeline', () => {
  const vendor = (name, createdAt, cois, deletedAt = null) => ({
    id: name, name, trade: 'Electrical', createdAt: at(createdAt), deletedAt: deletedAt ? at(deletedAt) : null,
    cois: cois.map(([submitted, gl]) => ({ submittedAt: at(submitted), glExpirationDate: at(gl) })),
  });

  const run = (vendors, from = '2026-01-01', to = '2026-09-19', keys = ['gl']) =>
    buildTimeline(vendors, { from, to, keys });

  it('counts an unbroken policy as full coverage', () => {
    const { rows } = run([vendor('Continuous', '2026-01-01', [['2026-01-01', '2027-01-01']])]);
    expect(rows[0].full).toBe(true);
    expect(rows[0].gapDays).toBe(0);
  });

  it('finds the gap between two certificates and dates it', () => {
    const { rows } = run([
      vendor('Lapsed', '2026-01-01', [['2026-01-01', '2026-06-30'], ['2026-07-18', '2026-12-31']]),
    ]);
    expect(rows[0].full).toBe(false);
    expect(rows[0].gapDays).toBe(18);
    expect(rows[0].firstGap).toEqual({ from: '2026-06-30', to: '2026-07-18' });
  });

  it('does not count days before a vendor existed as a gap', () => {
    const { rows } = run([vendor('Late joiner', '2026-06-01', [['2026-06-01', '2027-01-01']])]);
    expect(rows[0].full).toBe(true);
    expect(rows[0].segments[0].state).toBe('inactive');
    expect(rows[0].segments[0].to).toBe('2026-06-01');
  });

  it('stops counting once a vendor is removed', () => {
    const { rows } = run([vendor('Departed', '2026-01-01', [['2026-01-01', '2026-05-30']], '2026-05-30')]);
    expect(rows[0].full).toBe(true);
    expect(rows[0].segments[rows[0].segments.length - 1].state).toBe('inactive');
  });

  it('requires every selected coverage on the same day', () => {
    const v = {
      id: 'multi', name: 'Multi', trade: 'HVAC', createdAt: at('2026-01-01'), deletedAt: null,
      cois: [{
        submittedAt: at('2026-01-01'),
        glExpirationDate: at('2027-01-01'),
        wcExpirationDate: at('2026-06-01'), // lapses mid-period
      }],
    };
    expect(run([v], '2026-01-01', '2026-09-19', ['gl']).rows[0].full).toBe(true);
    expect(run([v], '2026-01-01', '2026-09-19', ['gl', 'wc']).rows[0].full).toBe(false);
  });

  it('sorts the worst offender to the top', () => {
    const { rows } = run([
      vendor('Clean', '2026-01-01', [['2026-01-01', '2027-01-01']]),
      vendor('Bad', '2026-01-01', [['2026-01-01', '2026-03-01'], ['2026-08-01', '2027-01-01']]),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Bad', 'Clean']);
  });

  it('returns nothing for an inverted period', () => {
    expect(run([vendor('X', '2026-01-01', [['2026-01-01', '2027-01-01']])], '2026-09-19', '2026-01-01'))
      .toEqual({ rows: [], days: 0 });
  });

  it('reports the number of days in the window', () => {
    expect(run([], '2026-01-01', '2026-01-31').days).toBe(30);
  });
});
