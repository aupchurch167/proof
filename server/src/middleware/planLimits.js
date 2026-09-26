const prisma = require('../lib/prisma');
const plans = require('../config/plans');

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
      return {
        ok: false,
        status: 403,
        body: {
          error: `You've reached the vendor limit (${limits.maxVendors}) for your ${label} plan. Upgrade to add more.`,
          code: 'PLAN_LIMIT_EXCEEDED',
          resource: 'vendor',
          limit: limits.maxVendors,
          current: count,
          plan,
        },
      };
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

module.exports = { enforcePlanLimit, evaluatePlanLimit };
