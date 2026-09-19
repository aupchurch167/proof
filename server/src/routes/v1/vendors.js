const express = require('express');
const prisma = require('../../lib/prisma');
const { requireScope, SCOPES } = require('../../middleware/apiAuth');
const { data, paginated, errors, parseLimit, encodeCursor, decodeCursor } = require('../../http/respond');
const {
  COVERAGE_TYPES,
  serializeVendor,
  serializeCoiRequest,
  internalStatusesFor,
} = require('../../http/serializers');
const { generateUploadToken } = require('../../utils/tokens');
const { sendUploadRequestEmail } = require('../../services/email');
const { isValidTrade } = require('../../constants/trades');

const router = express.Router({ mergeParams: true });

// Pull the newest APPROVED COI (for coverages/expiry) and the last COI-request
// timestamp for each vendor in a single query, avoiding N+1 on the list route.
const VENDOR_INCLUDE = {
  cois: {
    where: { status: 'APPROVED' },
    orderBy: { submittedAt: 'desc' },
    take: 1,
  },
  notifications: {
    where: { type: 'UPLOAD_REQUEST', status: 'SENT' },
    orderBy: { sentAt: 'desc' },
    take: 1,
    select: { sentAt: true },
  },
};

function toSerializerOpts(vendor, detail) {
  return {
    latestApprovedCoi: vendor.cois?.[0] || null,
    lastRequestedAt: vendor.notifications?.[0]?.sentAt || null,
    detail,
  };
}

// GET /api/v1/orgs/:orgSlug/vendors — list/search vendors (bid-package picker).
router.get('/', requireScope(SCOPES.VENDORS_READ), async (req, res) => {
  try {
    const { search, trade, coiStatus } = req.query;
    const limit = parseLimit(req.query.limit);

    if (trade && !isValidTrade(trade)) {
      return errors.validation(res, 'Unknown trade filter', { trade });
    }

    const where = { orgId: req.org.id, deletedAt: null };
    if (trade) where.trade = trade;

    if (coiStatus) {
      const internal = internalStatusesFor(coiStatus);
      if (!internal) {
        return errors.validation(res, 'Unknown coiStatus filter', { coiStatus });
      }
      where.coiStatus = { in: internal };
    }

    const and = [];
    if (search) {
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    // Keyset pagination over (name, id) so the ordering used to sort matches the
    // ordering used to page — stable even when names collide.
    const cursor = decodeCursor(req.query.cursor);
    if (cursor && cursor.name != null && cursor.id != null) {
      and.push({
        OR: [
          { name: { gt: cursor.name } },
          { name: cursor.name, id: { gt: cursor.id } },
        ],
      });
    }
    if (and.length) where.AND = and;

    const rows = await prisma.vendor.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: VENDOR_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ name: last.name, id: last.id }) : null;

    return paginated(
      res,
      page.map((v) => serializeVendor(v, toSerializerOpts(v, false))),
      nextCursor,
      hasMore
    );
  } catch (err) {
    console.error('[API v1] list vendors error:', err);
    return errors.server(res);
  }
});

// GET /api/v1/orgs/:orgSlug/vendors/:vendorId — COI detail view.
router.get('/:vendorId', requireScope(SCOPES.VENDORS_READ), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.vendorId, orgId: req.org.id, deletedAt: null },
      include: VENDOR_INCLUDE,
    });
    if (!vendor) return errors.notFound(res, 'vendor_not_found', 'Vendor not found');

    return data(res, serializeVendor(vendor, toSerializerOpts(vendor, true)));
  } catch (err) {
    console.error('[API v1] get vendor error:', err);
    return errors.server(res);
  }
});

// GET /api/v1/orgs/:orgSlug/vendors/:vendorId/coi-requests — request history.
router.get('/:vendorId/coi-requests', requireScope(SCOPES.COI_REQUESTS_READ), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.vendorId, orgId: req.org.id, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) return errors.notFound(res, 'vendor_not_found', 'Vendor not found');

    const limit = parseLimit(req.query.limit);
    const where = { vendorId: vendor.id };

    // Keyset over (createdAt desc, id desc) — newest first.
    const cursor = decodeCursor(req.query.cursor);
    if (cursor && cursor.createdAt != null && cursor.id != null) {
      where.AND = [
        {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        },
      ];
    }

    const rows = await prisma.coiRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null;

    return paginated(res, page.map(serializeCoiRequest), nextCursor, hasMore);
  } catch (err) {
    console.error('[API v1] list coi-requests error:', err);
    return errors.server(res);
  }
});

// POST /api/v1/orgs/:orgSlug/vendors/:vendorId/coi-requests — "Request COI".
router.post('/:vendorId/coi-requests', requireScope(SCOPES.COI_REQUESTS_WRITE), async (req, res) => {
  try {
    const body = req.body || {};
    const { coverageTypes, note, requestedByEmail } = body;

    // Validation
    if (coverageTypes !== undefined) {
      if (!Array.isArray(coverageTypes) || coverageTypes.some((t) => !COVERAGE_TYPES.includes(t))) {
        return errors.validation(res, 'coverageTypes must be an array of known coverage types', {
          allowed: COVERAGE_TYPES,
        });
      }
    }
    if (note !== undefined && typeof note !== 'string') {
      return errors.validation(res, 'note must be a string');
    }
    if (requestedByEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedByEmail || '')) {
      return errors.validation(res, 'requestedByEmail must be a valid email');
    }

    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.vendorId, orgId: req.org.id, deletedAt: null },
      include: { organization: { select: { name: true, email: true, address: true } } },
    });
    if (!vendor) return errors.notFound(res, 'vendor_not_found', 'Vendor not found');

    // Idempotent-ish: never create a second open request for the same vendor.
    const open = await prisma.coiRequest.findFirst({
      where: { vendorId: vendor.id, status: 'REQUESTED' },
    });
    if (open) {
      return errors.conflict(res, 'coi_request_conflict', 'A COI request is already open for this vendor', {
        request: serializeCoiRequest(open),
      });
    }

    const created = await prisma.coiRequest.create({
      data: {
        orgId: req.org.id,
        vendorId: vendor.id,
        coverageTypes: Array.isArray(coverageTypes) ? coverageTypes : [],
        note: typeof note === 'string' ? note : null,
        requestedByEmail: requestedByEmail || null,
        source: 'api',
        apiClientId: req.apiClient?.id || null,
      },
    });

    // Kick off Proof's existing COI-request workflow: rotate the upload token,
    // email the vendor, and log it (so the app UI's cooldown + lastRequestedAt
    // see API-originated requests too). Best-effort — the request record stands
    // even if the email send fails.
    try {
      const uploadToken = generateUploadToken(vendor.id);
      await prisma.vendor.update({ where: { id: vendor.id }, data: { uploadToken } });
      const portalUrl = `${process.env.APP_URL}/portal/${uploadToken}`;
      const cc = vendor.additionalEmails?.length > 0 ? vendor.additionalEmails : undefined;
      await sendUploadRequestEmail(vendor.email, vendor.name, portalUrl, vendor.organization, cc);
      await prisma.notificationLog.create({
        data: {
          orgId: req.org.id,
          vendorId: vendor.id,
          type: 'UPLOAD_REQUEST',
          recipientEmail: vendor.email,
          status: 'SENT',
        },
      });
    } catch (mailErr) {
      console.error('[API v1] COI request email failed:', mailErr.message);
    }

    // Reflect the outstanding request as `pending` unless a COI already exists.
    if (vendor.coiStatus === 'NO_COI') {
      await prisma.vendor.update({ where: { id: vendor.id }, data: { coiStatus: 'PENDING' } });
    }

    return data(res, serializeCoiRequest(created), 201);
  } catch (err) {
    console.error('[API v1] create coi-request error:', err);
    return errors.server(res);
  }
});

module.exports = router;
