const express = require('express');
const prisma = require('../../lib/prisma');
const { requireScope, SCOPES } = require('../../middleware/apiAuth');
const { resource, paginated, errors, parseLimit, encodeCursor, decodeCursor } = require('../../http/respond');
const { serializeCoiRequest } = require('../../http/serializers');
const {
  validateCoiRequestBody,
  openRequestFor,
  createCoiRequest,
} = require('../../services/coiRequests');

const router = express.Router({ mergeParams: true });

// GET /api/v1/orgs/:orgSlug/coi-requests — org-wide request history.
// Optional ?vendorId= narrows it to one vendor.
router.get('/', requireScope(SCOPES.COI_REQUESTS_READ), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const where = { orgId: req.org.id };
    if (req.query.vendorId) where.vendorId = req.query.vendorId;
    if (req.query.status) {
      const status = String(req.query.status).toUpperCase();
      if (!['REQUESTED', 'FULFILLED', 'CANCELLED'].includes(status)) {
        return errors.validation(res, 'Unknown status filter', { status: req.query.status });
      }
      where.status = status;
    }

    // Keyset over (createdAt desc, id desc) — newest first, same as the
    // vendor-nested listing.
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
    console.error('[API v1] list org coi-requests error:', err);
    return errors.server(res);
  }
});

// POST /api/v1/orgs/:orgSlug/coi-requests — create a request for a vendor named
// in the body. This is the collection-style create external systems call after
// creating a vendor.
//
// Idempotent by design: if a request is already open for the vendor it returns
// that one with 200 rather than 409. A caller retrying a half-finished
// onboarding job (create vendor -> create request, where the second call
// failed) must be able to converge, and a second open request for the same
// vendor is never what anyone wants.
router.post('/', requireScope(SCOPES.COI_REQUESTS_WRITE), async (req, res) => {
  try {
    const body = req.body || {};
    const { vendorId } = body;

    if (typeof vendorId !== 'string' || !vendorId.trim()) {
      return errors.validation(res, 'vendorId is required');
    }
    const invalid = validateCoiRequestBody(body);
    if (invalid) return errors.validation(res, invalid.message, invalid.details || {});

    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId.trim(), orgId: req.org.id, deletedAt: null },
      include: { organization: { select: { name: true, email: true, address: true } } },
    });
    if (!vendor) return errors.notFound(res, 'vendor_not_found', 'Vendor not found');

    const open = await openRequestFor(vendor.id);
    if (open) {
      return resource(res, serializeCoiRequest(open), 200);
    }

    const created = await createCoiRequest({
      org: req.org,
      vendor,
      apiClientId: req.apiClient?.id || null,
      body,
    });

    return resource(res, serializeCoiRequest(created), 201);
  } catch (err) {
    console.error('[API v1] create org coi-request error:', err);
    return errors.server(res);
  }
});

module.exports = router;
