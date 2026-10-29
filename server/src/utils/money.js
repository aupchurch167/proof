// Whole-dollar amounts only. Cents are dollars * 100, which is exact for an
// integer. Fractional dollars are rejected so a float never lands in the
// Int columns (1.1 * 100 is not 110 in IEEE math).

const WHOLE_DOLLAR_ERROR = 'Enter a whole dollar amount, digits only';
const NEGATIVE_DOLLAR_ERROR = 'Enter a positive whole dollar amount';
const LARGE_DOLLAR_ERROR = 'That amount is too large';
const DAY_ERROR = 'Enter a whole number of days from 0 to 365';

// Int columns cap at 2,147,483,647 cents.
const MAX_WHOLE_DOLLARS = 21474836;

function finishDollars(dollars) {
  if (!Number.isSafeInteger(dollars) || dollars > MAX_WHOLE_DOLLARS) {
    return { ok: false, error: LARGE_DOLLAR_ERROR };
  }
  return { ok: true, dollars };
}

function parseWholeDollars(value) {
  if (value == null) return { ok: true, empty: true, dollars: null };

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, error: WHOLE_DOLLAR_ERROR };
    if (value < 0) return { ok: false, error: NEGATIVE_DOLLAR_ERROR };
    if (!Number.isInteger(value)) return { ok: false, error: WHOLE_DOLLAR_ERROR };
    return finishDollars(value);
  }

  if (typeof value !== 'string') return { ok: false, error: WHOLE_DOLLAR_ERROR };

  const trimmed = value.trim();
  if (!trimmed) return { ok: true, empty: true, dollars: null };

  const stripped = trimmed.replace(/[$,\s]/g, '');
  if (stripped.startsWith('-')) return { ok: false, error: NEGATIVE_DOLLAR_ERROR };

  // "1000000.00" is still a whole dollar. "1000000.50" is not.
  const normalized = stripped.replace(/\.0{1,2}$/, '');
  if (!/^\d+$/.test(normalized)) return { ok: false, error: WHOLE_DOLLAR_ERROR };

  return finishDollars(Number(normalized));
}

function dollarsToCents(dollars) {
  const parsed = typeof dollars === 'number' && Number.isInteger(dollars)
    ? finishDollars(dollars)
    : parseWholeDollars(dollars);
  if (!parsed.ok || parsed.empty) return null;
  const cents = parsed.dollars * 100;
  if (!Number.isSafeInteger(cents) || cents > 2147483647) return null;
  return cents;
}

function parseDayCount(value) {
  let days = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return { ok: false, error: DAY_ERROR };
    days = Number(trimmed);
  }
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 365) {
    return { ok: false, error: DAY_ERROR };
  }
  return { ok: true, days };
}

module.exports = {
  parseWholeDollars,
  dollarsToCents,
  parseDayCount,
  WHOLE_DOLLAR_ERROR,
  NEGATIVE_DOLLAR_ERROR,
  LARGE_DOLLAR_ERROR,
  DAY_ERROR,
  MAX_WHOLE_DOLLARS,
};
