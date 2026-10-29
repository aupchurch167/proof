// A vendor's current coverage is the union of its approved certificates, one
// line at a time. A newer certificate that omits general liability does not
// erase an older general-liability row. A newer certificate that includes the
// line replaces it, even when the new limit is lower or the date has passed.

const { COVERAGE_LINES } = require('./coverage');

function linePresent(coi, line) {
  if (!coi) return false;
  if (coi[line.amount] != null) return true;
  const expiration = coi[line.expiration];
  if (expiration != null && expiration !== '') return true;
  const policy = coi[line.policy];
  return policy != null && String(policy).trim() !== '';
}

function submittedMs(coi) {
  const t = new Date(coi?.submittedAt || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function newestFirst(cois) {
  return (cois || []).slice().sort((a, b) => {
    const dt = submittedMs(b) - submittedMs(a);
    if (dt) return dt;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function approvedNewestFirst(cois) {
  return newestFirst(cois).filter((coi) => coi && coi.status === 'APPROVED' && !coi.deletedAt);
}

function mergeApprovedCois(cois) {
  const approved = approvedNewestFirst(cois);
  if (approved.length === 0) return null;

  const merged = {
    id: approved[0].id || null,
    submittedAt: approved[0].submittedAt || null,
    status: 'APPROVED',
    certificateHolderName: null,
    certificateHolderAddress: null,
  };

  for (const line of COVERAGE_LINES) {
    const source = approved.find((coi) => linePresent(coi, line));
    merged[line.amount] = source ? source[line.amount] ?? null : null;
    merged[line.expiration] = source ? source[line.expiration] ?? null : null;
    merged[line.policy] = source ? source[line.policy] ?? null : null;
  }

  const holder = approved.find((coi) => {
    const name = coi.certificateHolderName;
    return name != null && String(name).trim() !== '';
  });
  if (holder) {
    merged.certificateHolderName = holder.certificateHolderName;
    merged.certificateHolderAddress = holder.certificateHolderAddress ?? null;
  }

  return merged;
}

// An older approved certificate is superseded only when every line it carries
// is also carried by a newer approved certificate. A split book of record
// (GL on one row, workers' comp on another) keeps both rows active.
function supersededApprovedIds(cois) {
  const approved = approvedNewestFirst(cois);
  const claimed = new Set();
  const ids = [];

  for (const coi of approved) {
    const lines = COVERAGE_LINES.filter((line) => linePresent(coi, line));
    if (lines.length === 0) {
      if (coi !== approved[0] && coi.id) ids.push(coi.id);
      continue;
    }
    const stillActive = lines.some((line) => !claimed.has(line.key));
    if (!stillActive && coi.id) ids.push(coi.id);
    for (const line of lines) claimed.add(line.key);
  }

  return ids;
}

module.exports = {
  linePresent,
  approvedNewestFirst,
  mergeApprovedCois,
  supersededApprovedIds,
};
