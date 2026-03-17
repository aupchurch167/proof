/**
 * Minimal CSV parser — handles quoted fields, commas inside quotes, and newlines.
 * Returns { headers: string[], rows: object[] }
 */
function parseCsv(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' && !inQuotes) {
      if (current.endsWith('\r')) current = current.slice(0, -1);
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length < 1) return { headers: [], rows: [] };

  const splitRow = (line) => {
    const fields = [];
    let field = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (ch === ',' && !q) {
        fields.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  };

  const headers = splitRow(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = splitRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Generate a CSV string from headers and optional sample rows.
 */
function generateCsv(headers, rows = []) {
  const escape = (val) => {
    const str = val == null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h] || '')).join(','));
  }
  return lines.join('\n');
}

// Expected template headers
const VENDOR_HEADERS = [
  'name',
  'email',
  'phone',
  'address',
];

const COI_HEADERS = [
  'vendor_email',
  'gl_policy_number',
  'gl_coverage_amount',
  'gl_expiration_date',
  'wc_policy_number',
  'wc_coverage_amount',
  'wc_expiration_date',
  'umb_policy_number',
  'umb_coverage_amount',
  'umb_expiration_date',
  'auto_policy_number',
  'auto_coverage_amount',
  'auto_expiration_date',
  'agent_name',
  'agent_email',
  'agent_phone',
  'insurance_company',
];

module.exports = { parseCsv, generateCsv, VENDOR_HEADERS, COI_HEADERS };
