// Maps Proof's internal audit trail onto the event vocabulary the Audit log
// screen filters by. Two sources feed one stream: AuditLog rows (things people
// did) and NotificationLog rows (things Proof sent), because from an auditor's
// point of view a reminder is as much an event as an approval.

const EVENT_TYPES = ['Uploaded', 'Approved', 'Reminder', 'Rejected', 'Status', 'Edited'];

const EVENT_TONE = {
  Uploaded: 'info',
  Approved: 'ok',
  Reminder: 'warn',
  Rejected: 'bad',
  Status: 'bad',
  Edited: 'none',
};

// (entity, action) -> event type. Anything unmapped falls through as "Edited",
// which is the honest label for a change we don't have a better name for.
const ACTION_EVENT = {
  'coi:create': 'Uploaded',
  'coi:upload': 'Uploaded',
  'coi:approve': 'Approved',
  'coi:reject': 'Rejected',
  'coi:update': 'Edited',
  'coi:reanalyze': 'Edited',
  'coi:delete': 'Status',
  'vendor:create': 'Status',
  'vendor:update': 'Edited',
  'vendor:delete': 'Status',
  'vendor:chase_escalated': 'Status',
  'vendor:mark_contacted': 'Reminder',
  'settings:update': 'Edited',
  'user:change_role': 'Edited',
  'user:remove': 'Status',
};

const NOTIFICATION_EVENT = {
  UPLOAD_REQUEST: 'Reminder',
  UPLOAD_CHASE: 'Reminder',
  EXPIRATION_REMINDER: 'Reminder',
  COI_REJECTED: 'Rejected',
  REVIEW_COMPLETE: 'Approved',
  MANUAL_CONTACT: 'Reminder',
  WEEKLY_SUMMARY: 'Reminder',
};

function eventTypeFor(entity, action) {
  return ACTION_EVENT[`${entity}:${action}`] || 'Edited';
}

// What a person would say happened. The audit log is read by people defending a
// decision months later, so it has to read as English, not as a table row.
const PHRASE = {
  'coi:create': 'certificate uploaded',
  'coi:upload': 'certificate uploaded',
  'coi:approve': 'certificate approved',
  'coi:reject': 'changes requested on certificate',
  'coi:update': 'certificate values corrected',
  'coi:reanalyze': 'certificate re-read by Proof',
  'coi:delete': 'certificate deleted',
  'vendor:create': 'vendor added',
  'vendor:update': 'vendor details changed',
  'vendor:delete': 'vendor removed',
  'vendor:chase_escalated': 'escalated — no reply after every reminder',
  'vendor:mark_contacted': 'marked as contacted',
  'settings:update': 'requirement template changed',
  'user:change_role': 'role changed',
  'user:remove': 'removed from the team',
};

function phraseFor(entity, action) {
  return PHRASE[`${entity}:${action}`] || `${action} ${entity}`;
}

// Notification types, said the way a person would.
const NOTIFICATION_PHRASE = {
  UPLOAD_REQUEST: 'certificate requested',
  UPLOAD_CHASE: 'follow-up reminder sent',
  EXPIRATION_REMINDER: 'expiry reminder sent',
  COI_REJECTED: 'rejection emailed',
  REVIEW_COMPLETE: 'approval emailed',
  MANUAL_CONTACT: 'contacted outside Proof',
  WEEKLY_SUMMARY: 'weekly summary sent',
};

// Which actor bucket the filter chips put an event in.
function actorGroup(by) {
  if (by === 'Proof') return 'Proof (automatic)';
  if (by.startsWith('Vendor')) return 'Vendors';
  return 'Team';
}

module.exports = {
  EVENT_TYPES,
  EVENT_TONE,
  eventTypeFor,
  phraseFor,
  actorGroup,
  NOTIFICATION_EVENT,
  NOTIFICATION_PHRASE,
};
