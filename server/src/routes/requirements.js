const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateVerified: authenticate, authorize } = require('../middleware/auth');
const { COVERAGE_LINES, coverageFor } = require('../services/coverage');
const { logAudit } = require('../services/audit');

const router = express.Router();

// Per-trade templates need a RequirementTemplate model. Until that exists every
// org has exactly one template, backed by the coverage minimums on
// OrganizationSettings. The shape below is already the multi-template shape so
// the client needs no rework when the model lands.
const DEFAULT_TEMPLATE_ID = 'default';

function toTemplate(settings, vendorCount) {
  return {
    id: DEFAULT_TEMPLATE_ID,
    name: 'Default — all trades',
    tradeFilter: [],
    vendorCount,
    isDefault: true,
    updatedAt: settings?.updatedAt || null,
    requireHolderMatch: settings?.requireHolderMatch ?? true,
    expiringWindowDays: settings?.expiringWindowDays ?? 30,
    coverages: COVERAGE_LINES.map((line) => {
      const cents = settings?.[line.setting] ?? 0;
      return {
        key: line.key,
        label: line.label,
        note: line.note,
        required: cents > 0,
        minLimit: cents > 0 ? Math.round(cents / 100) : null,
        setting: line.setting,
      };
    }),
  };
}

// An org that has never set a period still gets a sensible one: the current
// policy year. Returning nulls here would show "Policy year" selected with
// empty dates, which reads as broken.
function defaultPeriod() {
  const year = new Date().getFullYear();
  return {
    mode: 'Policy year',
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    warnInPeriod: true,
    retainForPeriod: true,
  };
}

// GET /api/requirements
router.get('/', authenticate, async (req, res) => {
  try {
    const [settings, org, vendorCount] = await Promise.all([
      prisma.organizationSettings.findUnique({ where: { orgId: req.user.orgId } }),
      prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { name: true, coveragePeriod: true } }),
      prisma.vendor.count({ where: { orgId: req.user.orgId, deletedAt: null } }),
    ]);

    res.json({
      orgName: org?.name || '',
      templates: [toTemplate(settings, vendorCount)],
      coveragePeriod: { ...defaultPeriod(), ...(org?.coveragePeriod || {}) },
      // Surfaced so the UI can say plainly why "New template" is unavailable
      // rather than offering a button that does nothing.
      multiTemplateSupported: false,
    });
  } catch (err) {
    console.error('Requirements error:', err);
    res.status(500).json({ error: 'Failed to load requirements' });
  }
});

/**
 * POST /api/requirements/impact — dry run.
 * Re-checks every vendor against proposed minimums and reports how many would
 * change verdict, so the editor can warn before anyone saves.
 */
router.post('/impact', authenticate, async (req, res) => {
  try {
    const proposed = req.body?.coverages;
    if (!Array.isArray(proposed)) {
      return res.status(400).json({ error: 'coverages must be an array' });
    }

    const settings = await prisma.organizationSettings.findUnique({ where: { orgId: req.user.orgId } });
    const next = { ...settings };
    for (const c of proposed) {
      const line = COVERAGE_LINES.find((l) => l.key === c.key);
      if (!line) continue;
      next[line.setting] = c.required ? Math.round((Number(c.minLimit) || 0) * 100) : 0;
    }

    const vendors = await prisma.vendor.findMany({
      where: { orgId: req.user.orgId, deletedAt: null },
      select: {
        id: true, name: true,
        cois: {
          where: { status: 'APPROVED', deletedAt: null },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    });

    const now = new Date();
    const failing = (s) => (vendor) => {
      const coverages = coverageFor(vendor.cois[0] || null, s, { now });
      return coverages.some((c) => ['missing', 'under', 'expired'].includes(c.verdict));
    };

    const failsNow = new Set(vendors.filter(failing(settings)).map((v) => v.id));
    const failsAfter = vendors.filter(failing(next));

    const newlyFailing = failsAfter.filter((v) => !failsNow.has(v.id));

    res.json({
      vendorCount: vendors.length,
      currentlyFailing: failsNow.size,
      wouldFail: failsAfter.length,
      newlyFailing: newlyFailing.length,
      examples: newlyFailing.slice(0, 5).map((v) => ({ id: v.id, name: v.name })),
    });
  } catch (err) {
    console.error('Requirements impact error:', err);
    res.status(500).json({ error: 'Failed to compute impact' });
  }
});

// PUT /api/requirements/:templateId
router.put('/:templateId', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    if (req.params.templateId !== DEFAULT_TEMPLATE_ID) {
      return res.status(404).json({
        error: 'Only the default template exists today — per-trade templates need the RequirementTemplate model',
        code: 'TEMPLATE_NOT_FOUND',
      });
    }

    const { coverages, requireHolderMatch, expiringWindowDays } = req.body || {};
    const data = {};

    if (coverages !== undefined) {
      if (!Array.isArray(coverages)) {
        return res.status(400).json({ error: 'coverages must be an array' });
      }
      for (const c of coverages) {
        const line = COVERAGE_LINES.find((l) => l.key === c.key);
        if (!line) return res.status(400).json({ error: `Unknown coverage: ${c.key}` });
        const dollars = Number(c.minLimit);
        if (c.required && (!Number.isFinite(dollars) || dollars <= 0)) {
          return res.status(400).json({ error: `${line.label} needs a minimum limit above zero` });
        }
        // A coverage that isn't required is stored as a zero minimum, which is
        // what every check already reads as "don't hold this against them".
        data[line.setting] = c.required ? Math.round(dollars * 100) : 0;
      }
    }
    if (requireHolderMatch !== undefined) data.requireHolderMatch = Boolean(requireHolderMatch);
    if (expiringWindowDays !== undefined) {
      const days = parseInt(expiringWindowDays, 10);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'expiringWindowDays must be between 1 and 365' });
      }
      data.expiringWindowDays = days;
    }

    const settings = await prisma.organizationSettings.update({
      where: { orgId: req.user.orgId },
      data,
    });

    logAudit({
      orgId: req.user.orgId,
      userId: req.user.id,
      action: 'update',
      entity: 'settings',
      entityId: settings.id,
      details: { template: 'Default — all trades', changed: Object.keys(data) },
      ipAddress: req.ip,
    });

    const vendorCount = await prisma.vendor.count({ where: { orgId: req.user.orgId, deletedAt: null } });
    res.json(toTemplate(settings, vendorCount));
  } catch (err) {
    console.error('Requirements update error:', err);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// PUT /api/requirements/coverage-period/set — the org-level audit window.
router.put('/coverage-period/set', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { mode, start, end, warnInPeriod, retainForPeriod } = req.body || {};
    for (const [field, value] of Object.entries({ start, end })) {
      if (value && Number.isNaN(new Date(value).getTime())) {
        return res.status(400).json({ error: `${field} must be a valid date` });
      }
    }
    if (start && end && new Date(end) <= new Date(start)) {
      return res.status(400).json({ error: 'The period must end after it starts' });
    }

    const coveragePeriod = {
      ...defaultPeriod(),
      ...(mode !== undefined && { mode }),
      ...(start !== undefined && { start }),
      ...(end !== undefined && { end }),
      ...(warnInPeriod !== undefined && { warnInPeriod: Boolean(warnInPeriod) }),
      ...(retainForPeriod !== undefined && { retainForPeriod: Boolean(retainForPeriod) }),
    };

    const org = await prisma.organization.update({
      where: { id: req.user.orgId },
      data: { coveragePeriod },
      select: { coveragePeriod: true },
    });

    res.json(org.coveragePeriod);
  } catch (err) {
    console.error('Coverage period error:', err);
    res.status(500).json({ error: 'Failed to save coverage period' });
  }
});

module.exports = router;
