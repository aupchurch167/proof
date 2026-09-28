const prisma = require('../lib/prisma');
const plans = require('../config/plans');
const { generateUploadToken } = require('../utils/tokens');

// A burst of creates can wait on the organization row lock. Keep this above
// the time a short queue of single-row inserts needs.
const VENDOR_CAP_TX = { maxWait: 20000, timeout: 20000 };

function vendorCapBody(plan, limit, current) {
  return {
    error: plans.vendorLimitReachedMessage(plan, limit),
    code: 'PLAN_LIMIT_EXCEEDED',
    resource: 'vendor',
    limit,
    current,
    plan,
  };
}

async function evaluatePlanLimit(orgId, resource) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true },
  });

  const plan = org?.plan || 'FREE';
  const limits = plans.getPlanLimits(plan);
  const label = plans.getPlanLabel(plan);

  if (resource === 'vendor') {
    if (limits.maxVendors === Infinity) return { ok: true };
    const count = await prisma.vendor.count({
      where: { orgId, deletedAt: null },
    });
    if (count >= limits.maxVendors) {
      return { ok: false, status: 403, body: vendorCapBody(plan, limits.maxVendors, count) };
    }
  }

  if (resource === 'coi') {
    if (limits.maxCois === Infinity) return { ok: true, current: null, limit: null };
    // Soft-deleted certificates stay on file but do not consume the plan cap.
    const count = await prisma.coi.count({
      where: { orgId, deletedAt: null },
    });
    if (count >= limits.maxCois) {
      return {
        ok: false,
        status: 403,
        current: count,
        limit: limits.maxCois,
        body: {
          error: `You've reached the COI limit (${limits.maxCois}) for your ${label} plan. Upgrade to add more.`,
          code: 'PLAN_LIMIT_EXCEEDED',
          resource: 'coi',
          limit: limits.maxCois,
          current: count,
          plan,
        },
      };
    }
    return { ok: true, current: count, limit: limits.maxCois };
  }

  return { ok: true };
}

function enforcePlanLimit(resource) {
  return async (req, res, next) => {
    try {
      const result = await evaluatePlanLimit(req.user.orgId, resource);
      if (!result.ok) return res.status(result.status).json(result.body);
      next();
    } catch (err) {
      console.error('Plan limit check failed:', err);
      return res.status(503).json({
        error: 'Plan limit check unavailable. Please try again.',
        code: 'PLAN_LIMIT_UNAVAILABLE',
      });
    }
  };
}

// Insert one vendor while the organization row is locked. Parallel creates,
// public applies, and CSV import rows then see each other's commits, so a
// finite cap cannot be passed. Unlimited plans are not rejected for count.
// Returns { ok: true, vendor } or { ok: false, reason: 'email' | 'cap', ... }.
async function createVendorUnderCap(orgId, data) {
  return prisma.$transaction(async (tx) => {
    // Organization.id is TEXT, not uuid. Compare it as text.
    const locked = await tx.$queryRaw`
      SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE
    `;
    if (!locked.length) {
      const err = new Error('Organization not found');
      err.code = 'ORG_NOT_FOUND';
      throw err;
    }

    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { plan: true },
    });
    const plan = org?.plan || 'FREE';
    const limits = plans.getPlanLimits(plan);

    // Same order as CSV import: an email already on file is a duplicate,
    // even when the account is also at its cap.
    const existing = await tx.vendor.findFirst({
      where: { orgId, email: data.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { ok: false, reason: 'email' };

    if (limits.maxVendors !== Infinity) {
      const current = await tx.vendor.count({ where: { orgId, deletedAt: null } });
      if (current >= limits.maxVendors) {
        return {
          ok: false,
          reason: 'cap',
          status: 403,
          body: vendorCapBody(plan, limits.maxVendors, current),
        };
      }
    }

    const vendor = await tx.vendor.create({
      data: { ...data, orgId },
    });
    const updated = await tx.vendor.update({
      where: { id: vendor.id },
      data: { uploadToken: generateUploadToken(vendor.id) },
    });
    return { ok: true, vendor: updated };
  }, VENDOR_CAP_TX);
}

module.exports = { enforcePlanLimit, evaluatePlanLimit, createVendorUnderCap };
