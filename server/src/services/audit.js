const prisma = require('../lib/prisma');

async function logAudit({ orgId, userId, action, entity, entityId, details, ipAddress }) {
  try {
    await prisma.auditLog.create({
      data: { orgId, userId, action, entity, entityId, details, ipAddress },
    });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

function stableAuditValue(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

function changedFieldNames(before, after, keys) {
  return keys.filter((key) => stableAuditValue(before?.[key]) !== stableAuditValue(after?.[key]));
}

module.exports = { logAudit, changedFieldNames };
