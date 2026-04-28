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

module.exports = { logAudit };
