// Maps Proof's internal audit trail onto the event vocabulary the Audit log
// screen filters by. Two sources feed one stream: AuditLog rows (things people
// did) and NotificationLog rows (things Proof sent), because from an auditor's
// point of view a reminder is as much an event as an approval.

const EVENT_TYPES = ['Uploaded', 'Approved', 'Reminder', 'Rejected', 'Status', 'Edited', 'Template'];

const EVENT_TONE = {
  Uploaded: 'info',
  Approved: 'ok',
  Reminder: 'warn',
  Rejected: 'bad',
  Status: 'bad',
  Edited: 'none',
  Template: 'none',
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
  'settings:update': 'Template',
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

// Which actor bucket the filter chips put an event in.
function actorGroup(by) {
  if (by === 'Proof') return 'Proof (automatic)';
  if (by.startsWith('Vendor')) return 'Vendors';
  return 'Team';
}

module.exports = { EVENT_TYPES, EVENT_TONE, eventTypeFor, actorGroup, NOTIFICATION_EVENT };
