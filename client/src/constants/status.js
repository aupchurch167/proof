// The UI speaks plain English; the database keeps its enums. Everything that
// renders a status goes through here so the two never drift.

// Vendor coiStatus -> what a person sees.
export const VENDOR_STATUS = {
  COMPLIANT: { label: 'Covered', tone: 'ok' },
  EXPIRING_SOON: { label: 'Expiring', tone: 'warn' },
  NON_COMPLIANT: { label: 'Gap', tone: 'bad' },
  EXPIRED: { label: 'Gap', tone: 'bad' },
  PENDING: { label: 'In review', tone: 'info' },
  NO_COI: { label: 'No COI', tone: 'none' },
};

// COI review status -> what a person sees.
export const COI_STATUS = {
  PENDING_REVIEW: { label: 'In review', tone: 'info' },
  APPROVED: { label: 'Active', tone: 'ok' },
  REJECTED: { label: 'Changes requested', tone: 'bad' },
  EXPIRED: { label: 'Expired', tone: 'none' },
  SUPERSEDED: { label: 'Superseded', tone: 'none' },
};

// The filter chips on the vendor list, in display order. Several DB statuses
// collapse into one chip (EXPIRED and NON_COMPLIANT are both a "Gap").
export const VENDOR_FILTERS = [
  { label: 'All', statuses: null },
  { label: 'Covered', statuses: ['COMPLIANT'] },
  { label: 'Expiring', statuses: ['EXPIRING_SOON'] },
  { label: 'Gap', statuses: ['NON_COMPLIANT', 'EXPIRED'] },
  { label: 'In review', statuses: ['PENDING'] },
  { label: 'No COI', statuses: ['NO_COI'] },
];

export function vendorStatus(coiStatus) {
  return VENDOR_STATUS[coiStatus] || VENDOR_STATUS.NO_COI;
}

export function coiStatus(status, { superseded = false } = {}) {
  if (superseded) return COI_STATUS.SUPERSEDED;
  return COI_STATUS[status] || COI_STATUS.PENDING_REVIEW;
}

// The four coverage lines, in the order they appear everywhere in the UI.
export const COVERAGES = [
  { key: 'gl', chip: 'GL', label: 'General liability', note: 'Per-occurrence limit' },
  { key: 'auto', chip: 'Auto', label: 'Auto liability', note: 'Combined single limit' },
  { key: 'wc', chip: 'WC', label: "Workers' compensation", note: 'Each accident' },
  { key: 'umb', chip: 'Umb', label: 'Umbrella / excess', note: 'Each occurrence' },
];

// Per-coverage verdicts used by the vendor detail cards and the review pane.
export const VERDICT = {
  meets: { label: 'Meets', tone: 'ok' },
  expiring: { label: 'Expiring', tone: 'warn' },
  missing: { label: 'Missing', tone: 'bad' },
  under: { label: 'Under limit', tone: 'bad' },
  expired: { label: 'Expired', tone: 'bad' },
  skipped: { label: 'Not required', tone: 'none' },
};
