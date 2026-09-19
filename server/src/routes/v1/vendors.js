const express = require('express');
const prisma = require('../../lib/prisma');
const { requireScope, SCOPES } = require('../../middleware/apiAuth');
const { resource, paginated, errors, parseLimit, encodeCursor, decodeCursor } = require('../../http/respond');
const {
  COVERAGE_TYPES,
  serializeVendor,
  serializeCoiRequest,
  internalStatusesFor,
} = require('../../http/serializers');
const { generateUploadToken } = require('../../utils/tokens');
const { isValidTrade, mapTradeToCanonical } = require('../../constants/trades');
const { getPlanLimits, getPlanLabel } = require('../../config/plans');
const { logAudit } = require('../../services/audit');
const core = require('../../lib/core');
const {
  validateCoiRequestBody,
  openRequestFor,
  createCoiRequest,
} = require('../../services/coiRequests');

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

// Build a routable-looking address for a vendor created without one. Proof
// requires an email on every Vendor; this mirrors the convention the Airtable
// importer uses so the "no real contact yet" state is recognisable and the
// record can still be created and fixed later.
function synthesizeEmail(name) {
  const slug = String(name || 'vendor')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'vendor';
  return `${slug}-${Date.now().toString(36)}@no-email.proofcoi.local`;
}

// POST /api/v1/orgs/:orgSlug/vendors — create a vendor from an external system.
//
// Idempotent on externalId: a retried create (the caller's job failed partway,
// or an operator hit retry) returns the vendor already linked to that id with
// 200 instead of duplicating it.
router.post('/', requireScope(SCOPES.VENDORS_WRITE), async (req, res) => {
  try {
    const body = req.body || {};
    const { name, email, phone, trade, externalId, contactName, address } = body;

    if (typeof name !== 'string' || !name.trim()) {
      return errors.validation(res, 'name is required');
    }
    for (const [field, value] of Object.entries({ email, phone, trade, externalId, contactName, address })) {
      if (value !== undefined && value !== null && typeof value !== 'string') {
        return errors.validation(res, `${field} must be a string when provided`);
      }
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errors.validation(res, 'email must be a valid email address', { email });
    }

    const normalizedExternalId = externalId ? externalId.trim() : null;

    if (normalizedExternalId) {
      const existing = await prisma.vendor.findFirst({
        where: { orgId: req.org.id, externalId: normalizedExternalId, deletedAt: null },
        include: VENDOR_INCLUDE,
      });
      if (existing) {
        return resource(res, serializeVendor(existing, toSerializerOpts(existing, true)), 200);
      }
    }

    // Callers carry their own trade vocabulary (MyProject sends ELECTRICAL,
    // FIRE_PROTECTION, OTHER...). Map what we recognise onto Proof's canonical
    // list and drop what we don't — an unfamiliar trade is not worth failing a
    // vendor create over, and the field is optional.
    let canonicalTrade = null;
    let tradeUnmapped = false;
    if (trade && trade.trim()) {
      canonicalTrade = mapTradeToCanonical(trade.trim());
      tradeUnmapped = canonicalTrade === null;
    }

    // The public API is a billable write path like any other, so it honours the
    // org's plan ceiling. 403 with a machine-readable code — never a 404.
    const org = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { plan: true },
    });
    const plan = org?.plan || 'FREE';
    const limits = getPlanLimits(plan);
    if (limits.maxVendors !== Infinity) {
      const count = await prisma.vendor.count({ where: { orgId: req.org.id, deletedAt: null } });
      if (count >= limits.maxVendors) {
        return errors.forbidden(
          res,
          `This organization has reached the vendor limit (${limits.maxVendors}) for its ${getPlanLabel(plan)} plan.`
        );
      }
    }

    let created;
    try {
      created = await prisma.vendor.create({
        data: {
          orgId: req.org.id,
          name: name.trim(),
          email: email ? email.trim() : synthesizeEmail(name),
          phone: phone ? phone.trim() : null,
          contactName: contactName ? contactName.trim() : null,
          address: address ? address.trim() : null,
          trade: canonicalTrade,
          externalId: normalizedExternalId,
        },
      });
    } catch (err) {
      // Lost a race against a concurrent create for the same externalId.
      if (err.code === 'P2002' && normalizedExternalId) {
        const existing = await prisma.vendor.findFirst({
          where: { orgId: req.org.id, externalId: normalizedExternalId },
          include: VENDOR_INCLUDE,
        });
        if (existing) {
          return resource(res, serializeVendor(existing, toSerializerOpts(existing, true)), 200);
        }
      }
      throw err;
    }

    // Replace the default UUID token with a signed JWT the portal can verify.
    const vendor = await prisma.vendor.update({
      where: { id: created.id },
      data: { uploadToken: generateUploadToken(created.id) },
      include: VENDOR_INCLUDE,
    });

    logAudit({
      orgId: req.org.id,
      action: 'create',
      entity: 'vendor',
      entityId: vendor.id,
      details: { name: vendor.name, email: vendor.email, externalId: normalizedExternalId, via: 'api', apiClientId: req.apiClient?.id || null },
      ipAddress: req.ip,
    });

    mirrorCreateToCore(vendor);

    if (tradeUnmapped) {
      console.warn(`[API v1] Unrecognized trade "${trade}" on vendor create; stored as null`);
    }

    return resource(res, serializeVendor(vendor, toSerializerOpts(vendor, true)), 201);
  } catch (err) {
    console.error('[API v1] create vendor error:', err);
    return errors.server(res);
  }
});

// Mirror the new vendor into Helm Core so `coreVendorId` fills in, matching what
// the app's own create does. Best-effort: Core being down must not fail the API
// create, and the next update will retry the link.
async function mirrorCreateToCore(vendor) {
  if (!core.isEnabled()) return;
  try {
    const result = await core.createVendor(vendor);
    const coreId = result && result.data && result.data.id;
    if (coreId) {
      await prisma.vendor.update({ where: { id: vendor.id }, data: { coreId } });
    } else {
      console.warn('[Core] createVendor returned no id; vendor not linked', { vendorId: vendor.id });
    }
  } catch (err) {
    console.error('[Core] Failed to mirror vendor create:', core.formatError(err));
  }
}

// GET /api/v1/orgs/:orgSlug/vendors/:vendorId — COI detail view.
router.get('/:vendorId', requireScope(SCOPES.VENDORS_READ), async (req, res) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.vendorId, orgId: req.org.id, deletedAt: null },
      include: VENDOR_INCLUDE,
    });
    if (!vendor) return errors.notFound(res, 'vendor_not_found', 'Vendor not found');

    return resource(res, serializeVendor(vendor, toSerializerOpts(vendor, true)));
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
//
// The vendor-nested form of the create below. It keeps its 409-on-open-request
// behaviour: this is the interactive "Request COI" action, where telling the
// caller a request is already outstanding is the useful answer. The top-level
// collection route is the idempotent machine-to-machine path.
router.post('/:vendorId/coi-requests', requireScope(SCOPES.COI_REQUESTS_WRITE), async (req, res) => {
  try {
    const body = req.body || {};
    const invalid = validateCoiRequestBody(body);
    if (invalid) return errors.validation(res, invalid.message, invalid.details || {});

    const vendor = await prisma.vendor.findFirst({
      where: { id: req.params.vendorId, orgId: req.org.id, deletedAt: null },
      include: { organization: { select: { name: true, email: true, address: true } } },
    });
    if (!vendor) return errors.notFound(res, 'vendor_not_found', 'Vendor not found');

    const open = await openRequestFor(vendor.id);
    if (open) {
      return errors.conflict(res, 'coi_request_conflict', 'A COI request is already open for this vendor', {
        request: serializeCoiRequest(open),
      });
    }

    const created = await createCoiRequest({
      org: req.org,
      vendor,
      apiClientId: req.apiClient?.id || null,
      body,
    });

    return resource(res, serializeCoiRequest(created), 201);
  } catch (err) {
    console.error('[API v1] create coi-request error:', err);
    return errors.server(res);
  }
});

module.exports = router;
