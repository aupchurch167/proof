const express = require('express');
const prisma = require('../../lib/prisma');
const { requireScope, SCOPES } = require('../../middleware/apiAuth');
const { data, paginated, errors, parseLimit, encodeCursor, decodeCursor } = require('../../http/respond');
const { serializeHistoricalCoi, serializeSignedDocument } = require('../../http/serializers');
const { coverageOverlapWhere, resolveActivityWindow } = require('../../http/coiCoverageWindow');
const { getSignedUrl } = require('../../services/storage');

const router = express.Router({ mergeParams: true });

// Approved certificates with a stored PDF. Empty pdfPath (legacy import/seed
// rows) is treated as "not set".
const APPROVED_WITH_PDF = {
  status: 'APPROVED',
  NOT: [{ pdfPath: '' }],
};

async function signDocument(coi) {
  const url = await getSignedUrl(coi.pdfPath);
  return serializeSignedDocument(coi.pdfPath, url);
}

// GET /api/v1/orgs/:orgSlug/cois — historical approved COIs whose coverage
// overlapped [activeFrom, activeTo]. See http/coiCoverageWindow.js for the
// overlap rule (start = submittedAt; end = earliest expiration or submittedAt).
router.get('/', requireScope(SCOPES.VENDORS_READ), async (req, res) => {
  try {
    const window = resolveActivityWindow(req.query);
    if (window.error) {
      return errors.validation(res, window.error, window.details || {});
    }
    const { activeFrom, activeTo } = window;

    const limit = parseLimit(req.query.limit);
    const where = {
      orgId: req.org.id,
      ...APPROVED_WITH_PDF,
      AND: [coverageOverlapWhere(activeFrom, activeTo)],
    };

    // Keyset over (submittedAt desc, id desc) — newest submission first, stable
    // when two rows share a timestamp.
    const cursor = decodeCursor(req.query.cursor);
    if (cursor && cursor.submittedAt != null && cursor.id != null) {
      where.AND.push({
        OR: [
          { submittedAt: { lt: new Date(cursor.submittedAt) } },
          { submittedAt: new Date(cursor.submittedAt), id: { lt: cursor.id } },
        ],
      });
    }

    const rows = await prisma.coi.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { vendor: { select: { id: true, name: true } } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ submittedAt: last.submittedAt.toISOString(), id: last.id })
      : null;

    const settings = await prisma.organizationSettings.findUnique({ where: { orgId: req.org.id } });
    const items = await Promise.all(
      page.map(async (coi) => serializeHistoricalCoi(coi, await signDocument(coi), { settings }))
    );

    return paginated(res, items, nextCursor, hasMore);
  } catch (err) {
    console.error('[API v1] list cois error:', err);
    return errors.server(res);
  }
});

// GET /api/v1/orgs/:orgSlug/cois/:coiId/document — signed URL for one approved
// COI PDF in this org. 404 when missing, not approved, wrong org, or no file.
router.get('/:coiId/document', requireScope(SCOPES.VENDORS_READ), async (req, res) => {
  try {
    const coi = await prisma.coi.findFirst({
      where: {
        id: req.params.coiId,
        orgId: req.org.id,
        ...APPROVED_WITH_PDF,
      },
    });
    if (!coi) {
      return errors.notFound(res, 'coi_not_found', 'Approved COI not found');
    }

    const document = await signDocument(coi);
    return data(res, { ...document, coiId: coi.id });
  } catch (err) {
    console.error('[API v1] get COI document error:', err);
    return errors.server(res);
  }
});

module.exports = router;
