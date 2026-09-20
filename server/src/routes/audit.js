const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateVerified: authenticate } = require('../middleware/auth');
const {
  EVENT_TYPES, EVENT_TONE, eventTypeFor, phraseFor, actorGroup,
  NOTIFICATION_EVENT, NOTIFICATION_PHRASE,
} = require('../services/auditEvents');

const router = express.Router();

const RANGE_DAYS = { '7': 7, '30': 30, all: 36500 };

function sentence(entity, action, details) {
  const name = details?.vendorName || details?.name || null;
  const phrase = phraseFor(entity, action);
  return name ? `${name} — ${phrase}` : phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// GET /api/audit — the event log, already filtered and counted.
//
// Counts are computed over the range+actor+search selection but BEFORE the
// type filter, so the event-type tiles can show how many of each there are
// without the tiles fighting each other.
router.get('/', authenticate, async (req, res) => {
  try {
    const { range = '30', actor = 'Anyone', type = 'All', search = '', vendorId } = req.query;
    const days = RANGE_DAYS[range] || 30;
    const since = new Date(Date.now() - days * 86400000);
    const q = String(search).trim().toLowerCase();

    // Audit rows for a vendor's certificates carry the COI id, not the vendor
    // id, so the vendor timeline has to match both.
    let entityIds = null;
    if (vendorId) {
      const cois = await prisma.coi.findMany({
        where: { vendorId, orgId: req.user.orgId },
        select: { id: true },
      });
      entityIds = [vendorId, ...cois.map((c) => c.id)];
    }

    const [auditRows, notificationRows] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          orgId: req.user.orgId,
          createdAt: { gte: since },
          ...(entityIds && { entityId: { in: entityIds } }),
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.notificationLog.findMany({
        where: {
          orgId: req.user.orgId,
          sentAt: { gte: since },
          ...(vendorId && { vendorId }),
        },
        orderBy: { sentAt: 'desc' },
        take: 500,
        include: { vendor: { select: { id: true, name: true } } },
      }),
    ]);

    // Resolve actor names in one go rather than per row.
    const userIds = [...new Set(auditRows.map((r) => r.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const userById = Object.fromEntries(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    const events = [
      ...auditRows.map((row) => ({
        id: `a_${row.id}`,
        at: row.createdAt,
        type: eventTypeFor(row.entity, row.action),
        detail: sentence(row.entity, row.action, row.details),
        by: row.userId ? userById[row.userId] || 'Team member' : 'Proof',
        entity: row.entity,
        entityId: row.entityId,
        fields: row.details || null,
      })),
      ...notificationRows.map((row) => ({
        id: `n_${row.id}`,
        at: row.sentAt,
        type: NOTIFICATION_EVENT[row.type] || 'Reminder',
        detail: `${row.vendor?.name || row.recipientEmail} — ${NOTIFICATION_PHRASE[row.type] || 'notification sent'}`
          + (row.status === 'FAILED' ? ' (not delivered)' : '')
          + (row.meta?.step ? ` · follow-up at day ${row.meta.step}` : '')
          + (row.meta?.window != null ? ` · ${row.meta.window}-day notice` : ''),
        by: 'Proof',
        entity: 'vendor',
        entityId: row.vendorId,
        fields: {
          'Sent to': row.recipientEmail,
          Delivery: row.status === 'SENT' ? 'Delivered' : 'Not delivered',
          ...(row.meta || {}),
        },
      })),
    ];

    const matchesActor = (e) => actor === 'Anyone' || actorGroup(e.by) === actor;
    const matchesSearch = (e) => !q || e.detail.toLowerCase().includes(q) || e.by.toLowerCase().includes(q);

    const inScope = events.filter((e) => matchesActor(e) && matchesSearch(e));
    inScope.sort((a, b) => new Date(b.at) - new Date(a.at));

    const counts = { All: inScope.length };
    for (const t of EVENT_TYPES) counts[t] = inScope.filter((e) => e.type === t).length;

    const filtered = type === 'All' ? inScope : inScope.filter((e) => e.type === type);

    res.json({
      events: filtered.map((e) => ({ ...e, tone: EVENT_TONE[e.type] || 'none' })),
      counts,
      total: events.length,
      types: EVENT_TYPES,
    });
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

// GET /api/audit/week — the "Proof did this week" panel on the dashboard.
router.get('/week', authenticate, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 86400000);
    const orgId = req.user.orgId;

    const [certificatesRead, remindersSent, renewalsReceived, issuesCaught] = await Promise.all([
      prisma.coi.count({ where: { orgId, submittedAt: { gte: since } } }),
      prisma.notificationLog.count({
        where: {
          orgId,
          status: 'SENT',
          type: { in: ['UPLOAD_REQUEST', 'UPLOAD_CHASE', 'EXPIRATION_REMINDER'] },
          sentAt: { gte: since },
        },
      }),
      prisma.coi.count({ where: { orgId, status: 'APPROVED', reviewedAt: { gte: since } } }),
      // An "issue caught" is a certificate the checks turned away, plus one
      // Proof read and flagged without anyone having to notice it.
      prisma.coi.count({
        where: {
          orgId,
          submittedAt: { gte: since },
          OR: [{ status: 'REJECTED' }, { NOT: { complianceFlags: { equals: null } } }],
        },
      }),
    ]);

    res.json({ certificatesRead, remindersSent, renewalsReceived, issuesCaught });
  } catch (err) {
    console.error('Audit week error:', err);
    res.status(500).json({ error: 'Failed to load weekly activity' });
  }
});

module.exports = router;
