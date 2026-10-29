// Same whole-dollar rules as server/src/utils/money.js. Display uses the
// integer and en-US grouping so a float never turns "$1,000,000" into a
// long decimal that the next keystroke then misreads.

const WHOLE_DOLLAR_ERROR = 'Enter a whole dollar amount, digits only';
const NEGATIVE_DOLLAR_ERROR = 'Enter a positive whole dollar amount';
const LARGE_DOLLAR_ERROR = 'That amount is too large';
const DAY_ERROR = 'Enter a whole number of days from 0 to 365';
const MAX_WHOLE_DOLLARS = 21474836;

function finishDollars(dollars) {
  if (!Number.isSafeInteger(dollars) || dollars > MAX_WHOLE_DOLLARS) {
    return { ok: false, error: LARGE_DOLLAR_ERROR };
  }
  return { ok: true, dollars };
}

export function parseWholeDollars(value) {
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

  const normalized = stripped.replace(/\.0{1,2}$/, '');
  if (!/^\d+$/.test(normalized)) return { ok: false, error: WHOLE_DOLLAR_ERROR };

  return finishDollars(Number(normalized));
}

export function formatWholeDollars(dollars) {
  if (dollars == null || dollars === '') return '';
  const parsed = parseWholeDollars(typeof dollars === 'number' ? dollars : String(dollars));
  if (!parsed.ok || parsed.empty) return String(dollars);
  return `$${parsed.dollars.toLocaleString('en-US')}`;
}

export function parseDayCount(value) {
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

export { WHOLE_DOLLAR_ERROR, NEGATIVE_DOLLAR_ERROR, DAY_ERROR };
